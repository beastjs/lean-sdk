export type EqualityFn<T> = (a: T, b: T) => boolean

export type ObservableListener<T> = (value: T, previousValue: T) => void

export interface ObservableSubscription {
  readonly closed: boolean
  unsubscribe(): void
}

export interface SubscribeOptions {
  signal?: AbortSignal
  immediate?: boolean
}

export interface ObservableOptions<T> {
  equalityFn?: EqualityFn<T>
  onListenerError?: (error: unknown) => void
}

export interface ReadonlyObservable<T> {
  readonly value: T
  readonly disposed: boolean
  readonly subscriberCount: number

  subscribe(listener: ObservableListener<T>, options?: SubscribeOptions): ObservableSubscription
}

interface InternalListener<T> {
  callback: ObservableListener<T>
  active: boolean
}

interface Change<T> {
  value: T
  previousValue: T
}

/**
 * A lightweight, framework-independent reactive value.
 *
 * Features:
 * - Typed subscriptions
 * - Custom equality comparison
 * - Reentrant-safe notification queue
 * - Listener removal during notification
 * - AbortSignal-backed subscriptions
 * - Listener error isolation
 * - Readonly observable views
 * - Disposal
 */
export class Observable<T> implements ReadonlyObservable<T> {
  private currentValue: T

  private readonly listeners = new Set<InternalListener<T>>()
  private readonly changeQueue: Change<T>[] = []

  private readonly equalityFn: EqualityFn<T>
  private readonly onListenerError?: ((error: unknown) => void) | undefined

  private notifying = false
  private isDisposed = false

  constructor(initialValue: T, options: ObservableOptions<T> = {}) {
    this.currentValue = initialValue
    this.equalityFn = options.equalityFn ?? Object.is
    this.onListenerError = options.onListenerError
  }

  get value(): T {
    return this.currentValue
  }

  get disposed(): boolean {
    return this.isDisposed
  }

  get subscriberCount(): number {
    return this.listeners.size
  }

  /**
   * Set the current value.
   *
   * Returns true when the value changed.
   */
  set(value: T): boolean {
    this.assertActive()

    const previousValue = this.currentValue

    if (this.equalityFn(previousValue, value)) {
      return false
    }

    this.currentValue = value

    this.changeQueue.push({
      value,
      previousValue
    })

    this.flushChanges()

    return true
  }

  /**
   * Update the current value using a callback.
   */
  update(updater: (currentValue: T) => T): boolean {
    this.assertActive()

    return this.set(updater(this.currentValue))
  }

  /**
   * Subscribe to changes.
   *
   * By default, listeners are only notified about future changes.
   * Set immediate=true to synchronously receive the current value.
   */
  subscribe(listener: ObservableListener<T>, options: SubscribeOptions = {}): ObservableSubscription {
    this.assertActive()

    if (typeof listener !== 'function') {
      throw new TypeError('Listener must be a function.')
    }

    const { signal, immediate = false } = options

    if (signal?.aborted) {
      return createClosedSubscription()
    }

    const entry: InternalListener<T> = {
      callback: listener,
      active: true
    }

    this.listeners.add(entry)

    let abortHandler: (() => void) | undefined

    const unsubscribe = () => {
      if (!entry.active) return

      entry.active = false
      this.listeners.delete(entry)

      if (abortHandler && signal) {
        signal.removeEventListener('abort', abortHandler)
      }
    }

    if (signal) {
      abortHandler = unsubscribe

      signal.addEventListener('abort', abortHandler, {
        once: true
      })

      // Defensive check in case the signal aborts during registration.
      if (signal.aborted) {
        unsubscribe()
      }
    }

    const subscription: ObservableSubscription = {
      get closed() {
        return !entry.active
      },

      unsubscribe
    }

    if (immediate && entry.active) {
      this.invokeListener(entry, this.currentValue, this.currentValue)
    }

    return subscription
  }

  /**
   * Create a readonly view of this observable.
   */
  asReadonly(): ReadonlyObservable<T> {
    const observable = this

    return {
      get value() {
        return observable.value
      },

      get disposed() {
        return observable.disposed
      },

      get subscriberCount() {
        return observable.subscriberCount
      },

      subscribe(listener, options) {
        return observable.subscribe(listener, options)
      }
    }
  }

  /**
   * Remove all listeners and pending notifications.
   *
   * Disposal is idempotent.
   */
  dispose(): void {
    if (this.isDisposed) return

    this.isDisposed = true

    for (const listener of this.listeners) {
      listener.active = false
    }

    this.listeners.clear()
    this.changeQueue.length = 0
  }

  private flushChanges(): void {
    if (this.notifying || this.isDisposed) {
      return
    }

    this.notifying = true

    try {
      while (this.changeQueue.length > 0 && !this.isDisposed) {
        const change = this.changeQueue.shift()!

        const snapshot = Array.from(this.listeners)

        for (const listener of snapshot) {
          if (this.isDisposed) break
          if (!listener.active) continue

          this.invokeListener(listener, change.value, change.previousValue)
        }
      }
    } finally {
      this.notifying = false
    }
  }

  private invokeListener(listener: InternalListener<T>, value: T, previousValue: T): void {
    try {
      listener.callback(value, previousValue)
    } catch (error) {
      this.handleListenerError(error)
    }
  }

  private handleListenerError(error: unknown): void {
    try {
      this.onListenerError?.(error)
    } catch {
      // Error handlers must not break notification delivery.
    }
  }

  private assertActive(): void {
    if (this.isDisposed) {
      throw new Error('Observable has been disposed.')
    }
  }
}

/**
 * Create a closed subscription.
 *
 * Used when subscribing with an already-aborted signal.
 */
function createClosedSubscription(): ObservableSubscription {
  return {
    get closed() {
      return true
    },

    unsubscribe() {}
  }
}

/**
 * Create an observable value.
 */
export function observable<T>(initialValue: T, options?: ObservableOptions<T>): Observable<T> {
  return new Observable(initialValue, options)
}

/**
 * Create a readonly observable view.
 */
export function readonlyObservable<T>(source: Observable<T>): ReadonlyObservable<T> {
  return source.asReadonly()
}

/**
 * Create a derived observable that maps source values.
 *
 * The derived observable is disposed when the returned resource
 * is disposed. Disposing it unsubscribes from the source.
 */
export function mapObservable<T, U>(
  source: ReadonlyObservable<T>,
  mapper: (value: T) => U,
  options?: ObservableOptions<U>
): {
  observable: Observable<U>
  dispose(): void
} {
  const derived = new Observable(mapper(source.value), options)

  const subscription = source.subscribe((value) => {
    derived.set(mapper(value))
  })

  return {
    observable: derived,

    dispose() {
      subscription.unsubscribe()
      derived.dispose()
    }
  }
}

/**
 * Create a derived observable that only emits values
 * satisfying the predicate.
 */
export function filterObservable<T>(
  source: ReadonlyObservable<T>,
  predicate: (value: T) => boolean,
  options?: ObservableOptions<T>
): {
  observable: Observable<T>
  dispose(): void
} {
  const derived = new Observable(source.value, options)

  const subscription = source.subscribe((value) => {
    if (predicate(value)) {
      derived.set(value)
    }
  })

  return {
    observable: derived,

    dispose() {
      subscription.unsubscribe()
      derived.dispose()
    }
  }
}
