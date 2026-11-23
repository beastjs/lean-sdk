export type AbortListener = (reason: unknown) => void

export interface AbortSubscription {
  unsubscribe(): void
}

export interface AbortSignalResource {
  readonly signal: AbortSignal
  dispose(): void
}

export interface AbortSignalOptions {
  reason?: unknown
}

/**
 * Create a standardized AbortError.
 */
export function createAbortError(reason?: unknown, message = 'The operation was aborted.'): Error {
  if (reason instanceof Error) {
    return reason
  }

  const error = new Error(message)
  error.name = 'AbortError'

  if (reason !== undefined) {
    Object.defineProperty(error, 'cause', {
      configurable: true,
      enumerable: false,
      value: reason,
      writable: true
    })
  }

  return error
}

/**
 * Get the reason associated with an aborted signal.
 */
export function getAbortReason(signal: AbortSignal): unknown {
  if (!signal.aborted) {
    return undefined
  }

  return signal.reason ?? createAbortError()
}

/**
 * Throw if a signal has already been aborted.
 */
export function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return

  throw getAbortReason(signal)
}

/**
 * Subscribe to a signal's abort event.
 *
 * If the signal is already aborted, the callback runs immediately.
 * Returns an unsubscribe function.
 */
export function onAbort(signal: AbortSignal, listener: AbortListener): AbortSubscription {
  if (signal.aborted) {
    listener(getAbortReason(signal))

    return {
      unsubscribe() {}
    }
  }

  let active = true

  const handler = () => {
    if (!active) return

    active = false
    signal.removeEventListener('abort', handler)

    listener(getAbortReason(signal))
  }

  signal.addEventListener('abort', handler, { once: true })

  return {
    unsubscribe() {
      if (!active) return

      active = false
      signal.removeEventListener('abort', handler)
    }
  }
}

/**
 * Create an AbortController that is automatically aborted
 * when any supplied signal aborts.
 *
 * The returned controller is independent of the source signals.
 */
export function linkAbortSignals(...signals: (AbortSignal | undefined)[]): AbortController {
  const controller = new AbortController()

  const subscriptions: AbortSubscription[] = []

  const cleanup = () => {
    for (const subscription of subscriptions) {
      subscription.unsubscribe()
    }

    subscriptions.length = 0
  }

  for (const signal of signals) {
    if (!signal) continue

    if (signal.aborted) {
      controller.abort(getAbortReason(signal))
      cleanup()
      break
    }

    subscriptions.push(
      onAbort(signal, (reason) => {
        if (!controller.signal.aborted) {
          controller.abort(reason)
        }
        onAbort(controller.signal, cleanup)
        cleanup()
      })
    )
  }

  return controller
}

/**
 * Create a signal that aborts when any supplied signal aborts.
 */
export function abortSignalAny(...signals: (AbortSignal | undefined)[]): AbortSignal {
  return linkAbortSignals(...signals).signal
}

/**
 * Create a timeout-backed AbortSignal.
 *
 * Unlike AbortSignal.timeout(), this resource can be disposed
 * to clear the timer early.
 */
export function createTimeoutSignal(timeoutMs: number, options: AbortSignalOptions = {}): AbortSignalResource {
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
    throw new RangeError('timeoutMs must be a finite non-negative number.')
  }

  const controller = new AbortController()

  let disposed = false

  const timer = setTimeout(() => {
    if (disposed) return

    controller.abort(options.reason ?? createAbortError(undefined, 'The operation timed out.'))

    dispose()
  }, timeoutMs)

  function dispose(): void {
    if (disposed) return

    disposed = true
    clearTimeout(timer)
  }

  return {
    signal: controller.signal,
    dispose
  }
}

/**
 * Create an AbortSignal that aborts after a timeout.
 *
 * The timer is automatically cleared after abort.
 */
export function abortSignalTimeout(timeoutMs: number, options: AbortSignalOptions = {}): AbortSignal {
  return createTimeoutSignal(timeoutMs, options).signal
}

/**
 * Race a promise against an AbortSignal.
 *
 * The abort listener is removed when either side settles.
 */
export function raceWithAbort<T>(promise: PromiseLike<T> | T, signal?: AbortSignal): Promise<T> {
  if (!signal) {
    return Promise.resolve(promise)
  }

  if (signal.aborted) {
    return Promise.reject(getAbortReason(signal))
  }

  return new Promise<T>((resolve, reject) => {
    let settled = false

    const cleanup = () => {
      signal.removeEventListener('abort', onAbort)
    }

    const settle = (callback: () => void) => {
      if (settled) return

      settled = true
      cleanup()
      callback()
    }

    const onAbort = () => {
      settle(() => reject(getAbortReason(signal)))
    }

    signal.addEventListener('abort', onAbort, { once: true })

    Promise.resolve(promise).then(
      (value) => settle(() => resolve(value)),
      (error) => settle(() => reject(error))
    )

    // Defensive check in case abortion occurs during setup.
    if (signal.aborted) {
      onAbort()
    }
  })
}

/**
 * Run an operation with a signal and race its result against abortion.
 */
export async function abortable<T>(
  operation: (signal: AbortSignal) => T | PromiseLike<T>,
  signal?: AbortSignal
): Promise<T> {
  if (!signal) {
    const controller = new AbortController()

    return Promise.resolve().then(() => operation(controller.signal))
  }

  if (signal.aborted) {
    return Promise.reject(getAbortReason(signal))
  }

  return raceWithAbort(
    Promise.resolve().then(() => operation(signal)),
    signal
  )
}

/**
 * Create a child AbortController linked to a parent signal.
 *
 * Aborting the child does not abort the parent.
 */
export function createChildAbortController(parent?: AbortSignal): AbortController {
  return linkAbortSignals(parent)
}

/**
 * Convert a signal into a promise that rejects when aborted.
 */
export function abortPromise(signal: AbortSignal): Promise<never> {
  if (signal.aborted) {
    return Promise.reject(getAbortReason(signal))
  }

  return new Promise<never>((_, reject) => {
    onAbort(signal, reject)
  })
}

/**
 * Wait until a signal aborts.
 */
export function waitForAbort(signal: AbortSignal): Promise<unknown> {
  if (signal.aborted) {
    return Promise.resolve(getAbortReason(signal))
  }

  return new Promise((resolve) => {
    onAbort(signal, resolve)
  })
}

/**
 * Abort a controller if it has not already been aborted.
 */
export function abortController(controller: AbortController, reason?: unknown): boolean {
  if (controller.signal.aborted) {
    return false
  }

  controller.abort(reason ?? createAbortError())

  return true
}

/**
 * Create a new AbortController that automatically aborts
 * after a timeout or when the parent signal aborts.
 */
export function createAbortController(
  options: {
    signal?: AbortSignal
    timeoutMs?: number
    reason?: unknown
  } = {}
): AbortController {
  const signals: AbortSignal[] = []

  if (options.signal) {
    signals.push(options.signal)
  }

  let timeoutResource: AbortSignalResource | undefined

  if (options.timeoutMs !== undefined) {
    timeoutResource = createTimeoutSignal(options.timeoutMs, {
      reason: options.reason
    })

    signals.push(timeoutResource.signal)
  }

  const controller = linkAbortSignals(...signals)

  // Ensure the timeout is cleaned up if another signal wins.
  onAbort(controller.signal, () => {
    timeoutResource?.dispose()
  })

  return controller
}
