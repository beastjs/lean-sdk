import { Observable, type ReadonlyObservable } from './observable.js'

export type StateUpdater<S> = S | ((current: S) => S)

export type StateListener<S> = (state: S, previousState: S) => void

export type Selector<S, T> = (state: S) => T

export interface StateOptions<S> {
  equalityFn?: (a: S, b: S) => boolean
  onListenerError?: (error: unknown) => void
}

export interface StateSubscription {
  readonly closed: boolean
  unsubscribe(): void
}

export interface StateSubscribeOptions {
  signal?: AbortSignal
  immediate?: boolean
}

export interface SelectorOptions<T> {
  equalityFn?: (a: T, b: T) => boolean
  signal?: AbortSignal
  immediate?: boolean
}

interface TransactionFrame<S> {
  snapshot: S
}

export class StateStore<S> {
  private readonly stateObservable: Observable<S>

  private currentState: S
  private transactionDraft: S | undefined
  private transactionFrames: TransactionFrame<S>[] = []

  private isDisposed = false

  constructor(initialState: S, options: StateOptions<S> = {}) {
    this.currentState = initialState

    this.stateObservable = new Observable(initialState, {
      ...(options.equalityFn ? { equalityFn: options.equalityFn } : {}),
      ...(options.onListenerError ? { onListenerError: options.onListenerError } : {})
    })
  }

  get disposed(): boolean {
    return this.isDisposed
  }

  get transactionDepth(): number {
    return this.transactionFrames.length
  }

  getState(): S {
    return this.transactionFrames.length > 0 ? this.transactionDraft as S : this.currentState
  }

  get observable(): ReadonlyObservable<S> {
    return this.stateObservable.asReadonly()
  }

  setState(updater: StateUpdater<S>): S {
    this.assertActive()

    const current = this.getState()

    const next = typeof updater === 'function' ? (updater as (current: S) => S)(current) : updater

    this.applyState(next)

    return this.getState()
  }

  update(updater: (current: S) => S): S {
    return this.setState(updater)
  }

  patch<P extends Partial<S>>(patch: P | ((current: S) => P)): S {
    this.assertActive()

    const current = this.getState()

    if (typeof current !== 'object' || current === null || Array.isArray(current)) {
      throw new TypeError('patch() requires a non-null, non-array object state.')
    }

    const partial = typeof patch === 'function' ? patch(current) : patch

    this.applyState({
      ...current,
      ...partial
    })

    return this.getState()
  }

  transaction<T>(callback: (state: this) => T): T {
    this.assertActive()

    const snapshot = this.getState()

    if (this.transactionFrames.length === 0) {
      this.transactionDraft = snapshot
    }

    this.transactionFrames.push({ snapshot })

    let result: T
    try {
      result = callback(this)
    } catch (error) {
      this.transactionFrames.pop()
      this.transactionDraft = this.transactionFrames.length > 0 ? snapshot : undefined
      throw error
    }

    // Disposal abandons the pending draft and clears all transaction frames.
    if (this.isDisposed) return result

    this.transactionFrames.pop()
    if (this.transactionFrames.length === 0) {
      const committed = this.transactionDraft as S
      this.transactionDraft = undefined
      this.applyState(committed)
    }

    return result
  }

  subscribe(listener: StateListener<S>, options: StateSubscribeOptions = {}): StateSubscription {
    this.assertActive()

    return this.stateObservable.subscribe(listener, options)
  }

  subscribeSelector<T>(
    selector: Selector<S, T>,
    listener: (value: T, previousValue: T) => void,
    options: SelectorOptions<T> = {}
  ): StateSubscription {
    this.assertActive()

    if (options.signal?.aborted) {
      return createClosedSubscription()
    }

    const equalityFn = options.equalityFn ?? Object.is
    let selected = selector(this.getState())
    let emitInitial = options.immediate === true

    return this.stateObservable.subscribe(
      (state) => {
        if (emitInitial) {
          emitInitial = false
          listener(selected, selected)
          return
        }

        const nextSelected = selector(state)

        if (equalityFn(selected, nextSelected)) {
          return
        }

        const previousSelected = selected
        selected = nextSelected

        listener(nextSelected, previousSelected)
      },
      options
    )
  }

  select<T>(selector: Selector<S, T>): T {
    this.assertActive()

    return selector(this.getState())
  }

  dispose(): void {
    if (this.isDisposed) return

    this.isDisposed = true
    this.transactionFrames = []
    this.transactionDraft = undefined

    this.stateObservable.dispose()
  }

  private applyState(next: S): void {
    this.assertActive()

    if (this.transactionFrames.length > 0) {
      this.transactionDraft = next
      return
    }

    this.currentState = next
    this.stateObservable.set(next)
  }

  private assertActive(): void {
    if (this.isDisposed) {
      throw new Error('StateStore has been disposed.')
    }
  }
}

function createClosedSubscription(): StateSubscription {
  return {
    get closed() {
      return true
    },

    unsubscribe() {}
  }
}

export function createState<S>(initialState: S, options?: StateOptions<S>): StateStore<S> {
  return new StateStore(initialState, options)
}
