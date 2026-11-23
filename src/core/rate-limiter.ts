export type RateLimiterOptions = {
  /**
   * Maximum number of tokens the bucket can hold.
   */
  capacity: number

  /**
   * Number of tokens replenished per second.
   */
  refillRate: number

  /**
   * Initial token count.
   * Defaults to capacity.
   */
  initialTokens?: number

  /**
   * Injectable monotonic clock.
   * Defaults to performance.now().
   */
  now?: () => number
}

export type RateLimiterStats = {
  capacity: number
  refillRate: number
  tokens: number
  queued: number
  totalAcquired: number
  totalRejected: number
  disposed: boolean
}

type Waiter = {
  resolve: () => void
  reject: (error: unknown) => void
  signal?: AbortSignal
  abortListener?: () => void
}

export class RateLimiterDisposedError extends Error {
  constructor(message = 'Rate limiter has been disposed.') {
    super(message)
    this.name = 'RateLimiterDisposedError'
  }
}

export class RateLimitAbortError extends Error {
  constructor(message = 'Rate limit acquisition was aborted.') {
    super(message)
    this.name = 'AbortError'
  }
}

function validatePositiveFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive finite number.`)
  }
}

function validateNonNegativeFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative finite number.`)
  }
}

export class RateLimiter {
  private readonly capacity: number
  private readonly refillRate: number
  private readonly now: () => number

  private tokens: number
  private lastRefill: number

  private readonly queue: Waiter[] = []

  private timer: ReturnType<typeof setTimeout> | undefined

  private isDisposed = false

  private totalAcquired = 0
  private totalRejected = 0

  constructor(options: RateLimiterOptions) {
    validatePositiveFinite(options.capacity, 'capacity')
    validatePositiveFinite(options.refillRate, 'refillRate')

    const initialTokens = options.initialTokens ?? options.capacity

    validateNonNegativeFinite(initialTokens, 'initialTokens')

    if (initialTokens > options.capacity) {
      throw new RangeError('initialTokens cannot exceed capacity.')
    }

    this.capacity = options.capacity
    this.refillRate = options.refillRate
    this.tokens = initialTokens
    this.now = options.now ?? (() => performance.now())
    this.lastRefill = this.now()
  }

  /**
   * Acquire one token.
   *
   * Requests are fulfilled in FIFO order.
   * If a signal is supplied, the request can be cancelled while queued.
   */
  acquire(options: { signal?: AbortSignal } = {}): Promise<void> {
    if (this.isDisposed) {
      return Promise.reject(new RateLimiterDisposedError())
    }

    const { signal } = options

    if (signal?.aborted) {
      this.totalRejected++

      return Promise.reject(new RateLimitAbortError())
    }

    this.refill()

    if (this.queue.length === 0 && this.tokens >= 1) {
      this.tokens -= 1
      this.totalAcquired++

      return Promise.resolve()
    }

    return new Promise<void>((resolve, reject) => {
      const waiter: Waiter = {
        resolve,
        reject,
        ...(signal ? { signal } : {})
      }

      if (signal) {
        const abortListener = () => {
          this.removeWaiter(waiter)

          this.totalRejected++

          reject(new RateLimitAbortError())

          this.scheduleDrain()
        }

        waiter.abortListener = abortListener

        signal.addEventListener('abort', abortListener, {
          once: true
        })

        // Protect against abort occurring during registration.
        if (signal.aborted) {
          abortListener()
          return
        }
      }

      this.queue.push(waiter)

      this.scheduleDrain()
    })
  }

  /**
   * Attempt to acquire a token without waiting.
   */
  tryAcquire(): boolean {
    if (this.isDisposed) {
      return false
    }

    this.refill()

    // Preserve fairness for queued requests.
    if (this.queue.length > 0 || this.tokens < 1) {
      return false
    }

    this.tokens -= 1
    this.totalAcquired++

    return true
  }

  /**
   * Returns the currently available token count.
   *
   * This value includes tokens replenished since the last
   * refill calculation.
   */
  get availableTokens(): number {
    if (this.isDisposed) {
      return this.tokens
    }

    this.refill()

    return this.tokens
  }

  /**
   * Number of pending acquisition requests.
   */
  get pending(): number {
    return this.queue.length
  }

  /**
   * Whether the limiter has been disposed.
   */
  get disposed(): boolean {
    return this.isDisposed
  }

  /**
   * Reset the token bucket.
   *
   * Pending requests are preserved and processed normally.
   */
  reset(tokens = this.capacity): void {
    this.assertActive()

    validateNonNegativeFinite(tokens, 'tokens')

    if (tokens > this.capacity) {
      throw new RangeError('tokens cannot exceed capacity.')
    }

    this.clearTimer()

    this.tokens = tokens
    this.lastRefill = this.now()

    this.drain()
  }

  /**
   * Snapshot the limiter's current statistics.
   */
  getStats(): RateLimiterStats {
    if (!this.isDisposed) {
      this.refill()
    }

    return {
      capacity: this.capacity,
      refillRate: this.refillRate,
      tokens: this.tokens,
      queued: this.queue.length,
      totalAcquired: this.totalAcquired,
      totalRejected: this.totalRejected,
      disposed: this.isDisposed
    }
  }

  /**
   * Reject all pending requests and permanently dispose.
   */
  dispose(): void {
    if (this.isDisposed) {
      return
    }

    this.isDisposed = true

    this.clearTimer()

    const waiters = this.queue.splice(0)

    const error = new RateLimiterDisposedError()

    for (const waiter of waiters) {
      this.cleanupWaiter(waiter)

      this.totalRejected++

      waiter.reject(error)
    }
  }

  private refill(): void {
    const currentTime = this.now()

    const elapsed = Math.max(0, currentTime - this.lastRefill)

    if (elapsed === 0) {
      return
    }

    const replenished = (elapsed / 1000) * this.refillRate

    this.tokens = Math.min(this.capacity, this.tokens + replenished)

    this.lastRefill = currentTime
  }

  private drain(): void {
    if (this.isDisposed) {
      return
    }

    this.clearTimer()
    this.refill()

    while (this.queue.length > 0 && this.tokens >= 1) {
      const waiter = this.queue.shift()

      if (!waiter) {
        break
      }

      if (waiter.signal?.aborted) {
        this.cleanupWaiter(waiter)

        this.totalRejected++

        waiter.reject(new RateLimitAbortError())

        continue
      }

      this.tokens -= 1
      this.totalAcquired++

      this.cleanupWaiter(waiter)

      waiter.resolve()
    }

    if (this.queue.length > 0) {
      this.scheduleDrain()
    }
  }

  private scheduleDrain(): void {
    if (this.isDisposed || this.timer !== undefined) {
      return
    }

    if (this.queue.length === 0) {
      return
    }

    this.refill()

    if (this.tokens >= 1) {
      this.drain()
      return
    }

    const tokensNeeded = 1 - this.tokens

    const delayMs = (tokensNeeded / this.refillRate) * 1000

    this.timer = setTimeout(
      () => {
        this.timer = undefined
        this.drain()
      },
      Math.max(1, Math.ceil(delayMs))
    )
  }

  private removeWaiter(waiter: Waiter): void {
    const index = this.queue.indexOf(waiter)

    if (index === -1) {
      return
    }

    this.queue.splice(index, 1)

    this.cleanupWaiter(waiter)
  }

  private cleanupWaiter(waiter: Waiter): void {
    if (waiter.signal && waiter.abortListener) {
      waiter.signal.removeEventListener('abort', waiter.abortListener)
    }
  }

  private clearTimer(): void {
    if (this.timer === undefined) {
      return
    }

    clearTimeout(this.timer)

    this.timer = undefined
  }

  private assertActive(): void {
    if (this.isDisposed) {
      throw new RateLimiterDisposedError()
    }
  }
}

/**
 * Factory helper.
 */
export function createRateLimiter(options: RateLimiterOptions): RateLimiter {
  return new RateLimiter(options)
}
