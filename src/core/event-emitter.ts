/**
 * ==============================================================================
 * A strongly typed, lightweight event emitter.
 *
 * Features:
 * - Type-safe event names and argument tuples.
 * - on() and once() subscriptions.
 * - Unsubscribe functions.
 * - AbortSignal-based cleanup.
 * - Safe listener-error isolation.
 * - Snapshot-based dispatch.
 * - Re-entrant event emission.
 * - Listener introspection and cleanup.
 * ------------------------------------------------------------------------------
 */
type AnyListener = (...args: any[]) => void
export type EventArguments<T> = T extends readonly unknown[] ? T : never

export type EventKey<TEvents extends object> = {
  [K in keyof TEvents]: TEvents[K] extends readonly unknown[] ? K : never
}[keyof TEvents]

export type EventListener<TEvents extends object, TEvent extends EventKey<TEvents>> = (
  ...args: EventArguments<TEvents[TEvent]>
) => void

export type Unsubscribe = () => void

export interface SubscriptionOptions {
  /**
   * Automatically unsubscribe when the signal is aborted.
   */
  signal?: AbortSignal
}

export interface ListenerErrorContext<TEvents extends object> {
  event: EventKey<TEvents>
  listener: AnyListener
  error: unknown
}

export type ListenerErrorHandler<TEvents extends object> = (context: ListenerErrorContext<TEvents>) => void

interface ListenerRecord {
  listener: AnyListener
  once: boolean
  active: boolean
  abortCleanup: (() => void) | undefined
}

export interface EventEmitterOptions<TEvents extends object> {
  /**
   * Called when a listener throws.
   *
   * Errors thrown by this handler are also isolated.
   */
  onListenerError?: ListenerErrorHandler<TEvents>
}

export class EventEmitter<TEvents extends object> {
  private readonly listeners = new Map<EventKey<TEvents>, Set<ListenerRecord>>()

  private readonly onListenerError: ListenerErrorHandler<TEvents> | undefined

  private disposed = false

  constructor(options: EventEmitterOptions<TEvents> = {}) {
    this.onListenerError = options.onListenerError
  }

  /**
   * Subscribe to an event.
   *
   * Returns an idempotent unsubscribe function.
   */
  on<TEvent extends EventKey<TEvents>>(
    event: TEvent,
    listener: EventListener<TEvents, TEvent>,
    options: SubscriptionOptions = {}
  ): Unsubscribe {
    return this.addListener(event, listener, false, options)
  }

  /**
   * Subscribe to an event exactly once.
   *
   * The listener is removed before invocation, which makes once()
   * safe during recursive/re-entrant emissions.
   */
  once<TEvent extends EventKey<TEvents>>(
    event: TEvent,
    listener: EventListener<TEvents, TEvent>,
    options: SubscriptionOptions = {}
  ): Unsubscribe {
    return this.addListener(event, listener, true, options)
  }

  /**
   * Remove a listener by its original callback reference.
   */
  off<TEvent extends EventKey<TEvents>>(event: TEvent, listener: EventListener<TEvents, TEvent>): void {
    const records = this.listeners.get(event)

    if (!records) {
      return
    }

    for (const record of records) {
      if (record.listener === listener) {
        this.removeRecord(event, record)
      }
    }
  }

  /**
   * Emit an event.
   *
   * Returns true when at least one active listener existed.
   *
   * Dispatch uses a snapshot:
   * - New listeners won't run during the current emission.
   * - Removed listeners won't run if they have not yet been invoked.
   * - Listener ordering follows subscription order.
   */

  emit<TEvent extends EventKey<TEvents>>(event: TEvent, ...args: EventArguments<TEvents[TEvent]>): boolean {
    if (this.disposed) {
      return false
    }

    const records = this.listeners.get(event)

    if (!records || records.size === 0) {
      return false
    }

    const snapshot = Array.from(records)

    for (const record of snapshot) {
      if (!record.active) {
        continue
      }

      if (record.once) {
        this.removeRecord(event, record)
      }

      try {
        record.listener(...args)
      } catch (error) {
        this.reportListenerError(event, record.listener, error)
      }
    }

    return snapshot.length > 0
  }

  /**
   * Number of active listeners for an event.
   */
  listenerCount<TEvent extends EventKey<TEvents>>(event: TEvent): number {
    return this.listeners.get(event)?.size ?? 0
  }

  /**
   * List events which currently have active listeners.
   */
  eventNames(): EventKey<TEvents>[] {
    return Array.from(this.listeners.keys())
  }

  /**
   * Remove listeners for one event, or all listeners.
   */
  removeAllListeners<TEvent extends EventKey<TEvents>>(event?: TEvent): void {
    if (event !== undefined) {
      const records = this.listeners.get(event)

      if (!records) {
        return
      }

      for (const record of records) {
        this.removeRecord(event, record)
      }

      return
    }

    for (const [eventKey, records] of this.listeners) {
      for (const record of records) {
        this.removeRecord(eventKey, record)
      }
    }

    this.listeners.clear()
  }

  /**
   * Permanently dispose the emitter.
   *
   * All listeners are removed.
   * Future on()/once() subscriptions become no-ops.
   */
  dispose(): void {
    if (this.disposed) {
      return
    }

    this.disposed = true
    this.removeAllListeners()
  }

  /**
   * Whether the emitter has been permanently disposed.
   */
  get isDisposed(): boolean {
    return this.disposed
  }

  private addListener<TEvent extends EventKey<TEvents>>(
    event: TEvent,
    listener: EventListener<TEvents, TEvent>,
    once: boolean,
    options: SubscriptionOptions
  ): Unsubscribe {
    if (this.disposed || options.signal?.aborted) {
      return () => {}
    }

    const record: ListenerRecord = {
      listener: listener as AnyListener,
      once,
      active: true,
      abortCleanup: undefined
    }

    let records = this.listeners.get(event)

    if (!records) {
      records = new Set<ListenerRecord>()
      this.listeners.set(event, records)
    }

    records.add(record)

    const unsubscribe = () => {
      this.removeRecord(event, record)
    }

    if (options.signal) {
      const abortHandler = () => unsubscribe()

      options.signal.addEventListener('abort', abortHandler, {
        once: true
      })

      record.abortCleanup = () => {
        options.signal?.removeEventListener('abort', abortHandler)
      }

      // Protect against an abort occurring during registration.
      if (options.signal.aborted) {
        unsubscribe()
      }
    }

    return unsubscribe
  }

  private removeRecord(event: EventKey<TEvents>, record: ListenerRecord): void {
    if (!record.active) {
      return
    }

    record.active = false

    record.abortCleanup?.()
    record.abortCleanup = undefined

    const records = this.listeners.get(event)

    records?.delete(record)

    if (records?.size === 0) {
      this.listeners.delete(event)
    }
  }

  private reportListenerError(event: EventKey<TEvents>, listener: AnyListener, error: unknown): void {
    if (!this.onListenerError) {
      return
    }

    try {
      this.onListenerError({
        event,
        listener,
        error
      })
    } catch {
      // Error reporting must never break event dispatch.
    }
  }
}
