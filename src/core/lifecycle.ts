/**
 * Lifecycle states for a Lean Math SDK instance.
 */
export type LifecycleState = 'idle' | 'initializing' | 'ready' | 'disposing' | 'disposed' | 'error'

/**
 * Lifecycle state transition event.
 */
export interface LifecycleEvent {
  previous: LifecycleState
  current: LifecycleState
  timestamp: number
  error?: Error
}

/**
 * Options for waiting until the lifecycle is ready.
 */
export interface WaitUntilReadyOptions {
  signal?: AbortSignal | undefined
  timeoutMs?: number | undefined
}

/**
 * Error thrown when waiting for readiness is cancelled.
 */
export class LifecycleWaitCancelledError extends Error {
  constructor(message = 'Waiting for readiness was cancelled.') {
    super(message)
    this.name = 'LifecycleWaitCancelledError'
  }
}

/**
 * Error thrown when waiting for readiness exceeds its timeout.
 */
export class LifecycleWaitTimeoutError extends Error {
  readonly timeoutMs: number

  constructor(timeoutMs: number) {
    super(`Lifecycle readiness timed out after ${timeoutMs}ms.`)
    this.name = 'LifecycleWaitTimeoutError'
    this.timeoutMs = timeoutMs
  }
}

/**
 * Manages the lifecycle of an SDK resource.
 *
 * Features:
 * - Single initialization
 * - Deduplicated concurrent initialization
 * - Initialization cancellation on disposal
 * - Readiness waiting
 * - Lifecycle state subscriptions
 * - Initialization error tracking
 * - Safe, idempotent disposal
 *
 * Initialization is expected to be cooperative with AbortSignal.
 */
export class LifecycleManager<T> {
  private currentState: LifecycleState = 'idle'

  private resource: T | undefined

  private initializationPromise: Promise<T> | undefined

  private disposalPromise: Promise<void> | undefined

  private initializationController: AbortController | undefined

  private lastError: Error | undefined

  private readonly listeners = new Set<(event: LifecycleEvent) => void>()

  /**
   * Current lifecycle state.
   */
  get state(): LifecycleState {
    return this.currentState
  }

  /**
   * Whether initialization is currently in progress.
   */
  get initializing(): boolean {
    return this.currentState === 'initializing'
  }

  /**
   * Whether the resource is ready to use.
   */
  get ready(): boolean {
    return this.currentState === 'ready'
  }

  /**
   * Whether disposal has started.
   */
  get disposing(): boolean {
    return this.currentState === 'disposing'
  }

  /**
   * Whether the resource has been permanently disposed.
   */
  get disposed(): boolean {
    return this.currentState === 'disposed'
  }

  /**
   * The error that caused initialization to fail.
   */
  get error(): Error | undefined {
    return this.lastError
  }

  /**
   * The initialized resource.
   *
   * Returns undefined unless initialization completed successfully.
   */
  get value(): T | undefined {
    return this.currentState === 'ready' ? this.resource : undefined
  }

  /**
   * Initializes the resource.
   *
   * Concurrent calls share the same initialization promise.
   * Once ready, subsequent calls return the existing resource.
   */
  initialize(initializer: (signal: AbortSignal) => T | Promise<T>): Promise<T> {
    if (this.currentState === 'ready') {
      return Promise.resolve(this.resource as T)
    }

    if (this.currentState === 'initializing') {
      return this.initializationPromise as Promise<T>
    }

    if (this.currentState === 'disposing' || this.currentState === 'disposed') {
      return Promise.reject(new Error('Cannot initialize a disposed lifecycle.'))
    }

    if (this.currentState === 'error') {
      return Promise.reject(this.lastError ?? new Error('Lifecycle initialization previously failed.'))
    }

    const controller = new AbortController()

    this.initializationController = controller

    this.transition('initializing')

    // Invoke the initializer immediately so synchronous setup happens
    // before initialize() returns. Promise handling still captures errors.
    let initializationResult: T | Promise<T>

    try {
      initializationResult = initializer(controller.signal)
    } catch (error) {
      initializationResult = Promise.reject(error)
    }

    const promise = Promise.resolve(initializationResult)
      .then((resource) => {
        // Disposal may have started while initialization was running.
        if (controller.signal.aborted || this.currentState !== 'initializing') {
          throw new Error('Initialization was cancelled.')
        }

        this.resource = resource
        this.transition('ready')

        return resource
      })
      .catch((error: unknown) => {
        const normalized = error instanceof Error ? error : new Error(String(error))

        if (this.currentState === 'initializing') {
          this.lastError = normalized
          this.transition('error', normalized)
        }

        throw normalized
      })
      .finally(() => {
        this.initializationController = undefined
        this.initializationPromise = undefined
      })

    this.initializationPromise = promise

    return promise
  }

  /**
   * Waits until initialization completes successfully.
   *
   * Rejects if initialization fails, disposal begins, the
   * caller's signal aborts, or the timeout is reached.
   */
  waitUntilReady(options: WaitUntilReadyOptions = {}): Promise<T> {
    if (this.currentState === 'ready') {
      return Promise.resolve(this.resource as T)
    }

    if (this.currentState === 'error') {
      return Promise.reject(this.lastError ?? new Error('Lifecycle failed.'))
    }

    if (this.currentState === 'disposing' || this.currentState === 'disposed') {
      return Promise.reject(new Error('Lifecycle has been disposed.'))
    }

    if (options.signal?.aborted) {
      return Promise.reject(new LifecycleWaitCancelledError())
    }

    if (options.timeoutMs !== undefined && (!Number.isFinite(options.timeoutMs) || options.timeoutMs < 0)) {
      return Promise.reject(new RangeError('timeoutMs must be a non-negative number.'))
    }

    return new Promise<T>((resolve, reject) => {
      let settled = false
      let timeout: ReturnType<typeof setTimeout> | undefined

      let unsubscribe: (() => void) | undefined

      const cleanup = () => {
        unsubscribe?.()

        options.signal?.removeEventListener('abort', abortListener)

        if (timeout !== undefined) {
          clearTimeout(timeout)
        }
      }

      const finish = (callback: () => void) => {
        if (settled) return

        settled = true
        cleanup()
        callback()
      }

      const listener = (event: LifecycleEvent) => {
        if (event.current === 'ready') {
          finish(() => resolve(this.resource as T))
        } else if (event.current === 'error') {
          finish(() => reject(event.error ?? new Error('Lifecycle initialization failed.')))
        } else if (event.current === 'disposing' || event.current === 'disposed') {
          finish(() => reject(new Error('Lifecycle has been disposed.')))
        }
      }

      const abortListener = () => {
        finish(() => reject(new LifecycleWaitCancelledError()))
      }

      this.subscribe(listener)

      options.signal?.addEventListener('abort', abortListener, { once: true })

      if (options.timeoutMs !== undefined) {
        timeout = setTimeout(() => {
          finish(() => reject(new LifecycleWaitTimeoutError(options.timeoutMs!)))
        }, options.timeoutMs)
      }

      // Recheck after subscribing to avoid missing a state change.
      if (this.currentState === 'ready') {
        finish(() => resolve(this.resource as T))
      } else if (this.currentState === 'error') {
        finish(() => reject(this.lastError ?? new Error('Lifecycle failed.')))
      } else if (this.currentState === 'disposing' || this.currentState === 'disposed') {
        finish(() => reject(new Error('Lifecycle has been disposed.')))
      }
    })
  }

  /**
   * Subscribes to lifecycle state changes.
   *
   * Returns an unsubscribe function.
   */
  subscribe(listener: (event: LifecycleEvent) => void): () => void {
    this.listeners.add(listener)

    return () => {
      this.listeners.delete(listener)
    }
  }

  /**
   * Disposes the resource.
   *
   * Disposal is idempotent. Concurrent calls share the same promise.
   * Initialization is aborted if it is currently running.
   */
  dispose(disposer?: (resource: T | undefined) => void | Promise<void>): Promise<void> {
    if (this.currentState === 'disposed') {
      return Promise.resolve()
    }

    if (this.disposalPromise) {
      return this.disposalPromise
    }

    this.transition('disposing')

    this.initializationController?.abort()

    const initialization = this.initializationPromise

    const disposal = Promise.resolve()
      .then(async () => {
        // Wait for in-flight initialization to settle.
        if (initialization) {
          try {
            await initialization
          } catch {
            // Initialization failure is handled by lifecycle state.
          }
        }

        await disposer?.(this.resource)
      })
      .finally(() => {
        this.resource = undefined
        this.initializationPromise = undefined
        this.initializationController = undefined

        this.transition('disposed')
      })

    this.disposalPromise = disposal

    return disposal
  }

  /**
   * Throws if the lifecycle is not ready.
   */
  assertReady(): asserts this is LifecycleManager<T> {
    if (this.currentState !== 'ready') {
      throw new Error(`Lifecycle is not ready. Current state: ${this.currentState}.`)
    }
  }

  /**
   * Transitions the lifecycle state and notifies subscribers.
   */
  private transition(next: LifecycleState, error?: Error): void {
    if (this.currentState === next) return

    const previous = this.currentState

    this.currentState = next

    const event: LifecycleEvent = {
      previous,
      current: next,
      timestamp: Date.now(),
      ...(error ? { error } : {})
    }

    for (const listener of this.listeners) {
      try {
        listener(event)
      } catch {
        // Subscriber errors must never break lifecycle transitions.
      }
    }
  }
}
