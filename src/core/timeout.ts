/**
 * Timeout and cancellation utilities.
 *
 * Designed for:
 * - Lean worker execution
 * - Runtime initialization
 * - RPC requests
 * - Async task coordination
 * - Deadline-based operations
 */

export class TimeoutError extends Error {
  readonly timeoutMs: number

  constructor(timeoutMs: number, message?: string) {
    super(message ?? `Operation timed out after ${timeoutMs}ms`)

    this.name = 'TimeoutError'
    this.timeoutMs = timeoutMs

    Object.setPrototypeOf(this, new.target.prototype)
  }
}

export class AbortError extends Error {
  constructor(message = 'Operation was aborted') {
    super(message)

    this.name = 'AbortError'

    Object.setPrototypeOf(this, new.target.prototype)
  }
}

export interface TimeoutOptions {
  signal?: AbortSignal
  message?: string
}

export interface Deadline {
  readonly expiresAt: number
  readonly timeoutMs: number

  /**
   * Remaining time in milliseconds.
   * Always >= 0.
   */
  remaining(): number

  /**
   * Whether the deadline has passed.
   */
  isExpired(): boolean

  /**
   * Throws TimeoutError if the deadline has passed.
   */
  throwIfExpired(): void
}

/**
 * Validate a timeout duration.
 */
function validateTimeout(timeoutMs: number): void {
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
    throw new RangeError('timeoutMs must be a finite non-negative number')
  }
}

/**
 * Convert an AbortSignal reason into an AbortError.
 */
export function createAbortError(reason?: unknown): AbortError {
  if (reason instanceof AbortError) {
    return reason
  }

  const message = reason instanceof Error ? reason.message : reason == null ? 'Operation was aborted' : String(reason)

  return new AbortError(message)
}

/**
 * Abort-aware delay.
 *
 * Resolves after the specified duration.
 * Rejects immediately if the signal is aborted.
 */
export function delay(ms: number, options: TimeoutOptions = {}): Promise<void> {
  validateTimeout(ms)

  const { signal } = options

  if (signal?.aborted) {
    return Promise.reject(createAbortError(signal.reason))
  }

  return new Promise<void>((resolve, reject) => {
    let settled = false

    const cleanup = () => {
      clearTimeout(timer)

      signal?.removeEventListener('abort', onAbort)
    }

    const finish = () => {
      if (settled) {
        return
      }

      settled = true
      cleanup()
      resolve()
    }

    const onAbort = () => {
      if (settled) {
        return
      }

      settled = true
      cleanup()
      reject(createAbortError(signal?.reason))
    }

    const timer = setTimeout(finish, ms)

    signal?.addEventListener('abort', onAbort, {
      once: true
    })

    // Protect against an abort occurring during registration.
    if (signal?.aborted) {
      onAbort()
    }
  })
}

/**
 * Race an operation against a timeout and/or AbortSignal.
 *
 * Supports:
 * - Existing promises
 * - Promise-like values
 * - Async task factories receiving an AbortSignal
 *
 * When a timeout occurs, the task signal is aborted.
 *
 * Existing promises cannot be forcibly cancelled; use a task
 * factory when the operation supports cooperative cancellation.
 */
export function withTimeout<T>(
  operation: PromiseLike<T> | ((signal: AbortSignal) => PromiseLike<T> | T),
  timeoutMs: number,
  options: TimeoutOptions = {}
): Promise<T> {
  validateTimeout(timeoutMs)

  const { signal, message } = options

  if (signal?.aborted) {
    return Promise.reject(createAbortError(signal.reason))
  }

  const controller = new AbortController()

  return new Promise<T>((resolve, reject) => {
    let settled = false

    const cleanup = () => {
      clearTimeout(timer)

      signal?.removeEventListener('abort', onAbort)
    }

    const resolveOnce = (value: T) => {
      if (settled) {
        return
      }

      settled = true
      cleanup()
      resolve(value)
    }

    const rejectOnce = (error: unknown) => {
      if (settled) {
        return
      }

      settled = true
      cleanup()
      reject(error)
    }

    const onAbort = () => {
      const error = createAbortError(signal?.reason)

      controller.abort(error)
      rejectOnce(error)
    }

    const timer = setTimeout(() => {
      const error = new TimeoutError(timeoutMs, message)

      controller.abort(error)
      rejectOnce(error)
    }, timeoutMs)

    signal?.addEventListener('abort', onAbort, {
      once: true
    })

    if (signal?.aborted) {
      onAbort()
      return
    }

    try {
      const result = typeof operation === 'function' ? operation(controller.signal) : operation

      Promise.resolve(result).then(resolveOnce, rejectOnce)
    } catch (error) {
      rejectOnce(error)
    }
  })
}

/**
 * Race a promise against an AbortSignal.
 *
 * Unlike withTimeout(), this does not create a timer.
 */
export function raceWithSignal<T>(operation: PromiseLike<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    return Promise.reject(createAbortError(signal.reason))
  }

  return new Promise<T>((resolve, reject) => {
    let settled = false

    const cleanup = () => {
      signal.removeEventListener('abort', onAbort)
    }

    const resolveOnce = (value: T) => {
      if (settled) {
        return
      }

      settled = true
      cleanup()
      resolve(value)
    }

    const rejectOnce = (error: unknown) => {
      if (settled) {
        return
      }

      settled = true
      cleanup()
      reject(error)
    }

    const onAbort = () => {
      rejectOnce(createAbortError(signal.reason))
    }

    signal.addEventListener('abort', onAbort, {
      once: true
    })

    if (signal.aborted) {
      onAbort()
      return
    }

    Promise.resolve(operation).then(resolveOnce, rejectOnce)
  })
}

/**
 * Create an absolute deadline.
 *
 * Useful when multiple sequential operations must share
 * a single timeout budget.
 */
export function createDeadline(timeoutMs: number): Deadline {
  validateTimeout(timeoutMs)

  const expiresAt = Date.now() + timeoutMs

  return {
    expiresAt,
    timeoutMs,

    remaining(): number {
      return Math.max(0, expiresAt - Date.now())
    },

    isExpired(): boolean {
      return Date.now() >= expiresAt
    },

    throwIfExpired(): void {
      const remaining = this.remaining()

      if (remaining <= 0) {
        throw new TimeoutError(timeoutMs)
      }
    }
  }
}
