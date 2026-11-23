import { Deferred } from './deferred.js'

export interface Disposable {
  dispose(): void
}

export interface AsyncDisposable {
  disposeAsync(): Promise<void>
}

export type DisposeFn = VoidFunction

export type AsyncDisposeFn = () => unknown | Promise<unknown>

export type DisposableResource = Disposable | VoidFunction

export type AsyncDisposableResource = Disposable | AsyncDisposable | (VoidFunction | Promise<void>)

export class DisposableError extends Error {
  readonly errors: readonly unknown[]

  constructor(errors: readonly unknown[], message = 'One or more disposal operations failed.') {
    super(message)
    this.name = 'DisposableError'
    this.errors = errors
  }
}

function throwDisposalErrors(errors: unknown[], message: string): void {
  if (errors.length === 0) return

  if (errors.length === 1) {
    throw errors[0]
  }

  throw new DisposableError(errors, message)
}

function isDisposable(value: unknown): value is Disposable {
  return typeof value === 'object' && value !== null && 'dispose' in value && typeof value.dispose === 'function'
}

function isAsyncDisposable(value: unknown): value is AsyncDisposable {
  return (
    typeof value === 'object' && value !== null && 'disposeAsync' in value && typeof value.disposeAsync === 'function'
  )
}

/**
 * Manages synchronous cleanup callbacks in LIFO order.
 *
 * - Cleanup runs in reverse registration order.
 * - Disposal is idempotent.
 * - All cleanup callbacks are attempted, even when some fail.
 * - Resources can be transferred using move().
 */
export class DisposableStack implements Disposable {
  private disposers: DisposeFn[] = []
  private disposed = false

  get isDisposed(): boolean {
    return this.disposed
  }

  get size(): number {
    return this.disposers.length
  }

  /**
   * Register a cleanup callback.
   */
  defer(disposer: DisposeFn): void {
    this.assertActive()

    if (typeof disposer !== 'function') {
      throw new TypeError('Disposer must be a function.')
    }

    this.disposers.push(disposer)
  }

  /**
   * Register a resource or a cleanup callback.
   */
  use<T extends DisposableResource>(resource: T): T {
    this.assertActive()

    if (typeof resource === 'function') {
      this.defer(resource)
      return resource
    }

    if (!isDisposable(resource)) {
      throw new TypeError('Resource must implement dispose().')
    }

    this.defer(() => resource.dispose())
    return resource
  }

  /**
   * Dispose all registered resources in reverse order.
   */
  dispose(): void {
    if (this.disposed) return

    this.disposed = true

    const disposers = this.disposers
    this.disposers = []

    const errors: unknown[] = []

    for (let i = disposers.length - 1; i >= 0; i--) {
      try {
        disposers[i]!()
      } catch (error) {
        errors.push(error)
      }
    }

    throwDisposalErrors(errors, 'Multiple synchronous disposal operations failed.')
  }

  /**
   * Transfer ownership of all registered resources to a new stack.
   *
   * The original stack becomes permanently disposed.
   */
  move(): DisposableStack {
    this.assertActive()

    const stack = new DisposableStack()
    stack.disposers = this.disposers

    this.disposers = []
    this.disposed = true

    return stack
  }

  private assertActive(): void {
    if (this.disposed) {
      throw new Error('DisposableStack has already been disposed.')
    }
  }
}

/**
 * Manages asynchronous and synchronous cleanup callbacks in LIFO order.
 *
 * - Cleanup is sequential.
 * - Cleanup runs in reverse registration order.
 * - Disposal is idempotent.
 * - All cleanup callbacks are attempted, even when some fail.
 * - Resources can be transferred using move().
 */
export class AsyncDisposableStack implements AsyncDisposable {
  private disposers: AsyncDisposeFn[] = []
  private disposed = false
  private disposalPromise: Promise<void> | undefined

  get isDisposed(): boolean {
    return this.disposed
  }

  get size(): number {
    return this.disposers.length
  }

  /**
   * Register a cleanup callback.
   */
  defer(disposer: AsyncDisposeFn): void {
    this.assertActive()

    if (typeof disposer !== 'function') {
      throw new TypeError('Disposer must be a function.')
    }

    this.disposers.push(disposer)
  }

  /**
   * Register a resource or cleanup callback.
   */
  use<T extends AsyncDisposableResource>(resource: T): T {
    this.assertActive()

    if (typeof resource === 'function') {
      this.defer(resource)
      return resource
    }

    if (isAsyncDisposable(resource)) {
      this.defer(() => resource.disposeAsync())
      return resource
    }

    if (isDisposable(resource)) {
      this.defer(() => resource.dispose())
      return resource
    }

    throw new TypeError('Resource must implement dispose() or disposeAsync().')
  }

  /**
   * Dispose all registered resources sequentially in reverse order.
   *
   * Concurrent calls return the same disposal promise.
   */
  disposeAsync(): Promise<void> {
    if (this.disposalPromise) {
      return this.disposalPromise
    }

    if (this.disposed) {
      return Promise.resolve()
    }

    this.disposed = true

    const disposers = this.disposers
    this.disposers = []

    const disposal = new Deferred<void>()
    this.disposalPromise = disposal.promise
    disposal.resolve(this.runDisposers(disposers))

    return this.disposalPromise
  }

  /**
   * Transfer ownership of all registered resources to a new stack.
   */
  move(): AsyncDisposableStack {
    this.assertActive()

    const stack = new AsyncDisposableStack()
    stack.disposers = this.disposers

    this.disposers = []
    this.disposed = true

    return stack
  }

  private async runDisposers(disposers: AsyncDisposeFn[]): Promise<void> {
    const errors: unknown[] = []

    for (let i = disposers.length - 1; i >= 0; i--) {
      try {
        const result = disposers[i]!()
        if (result !== this.disposalPromise) await result
      } catch (error) {
        errors.push(error)
      }
    }

    throwDisposalErrors(errors, 'Multiple asynchronous disposal operations failed.')
  }

  private assertActive(): void {
    if (this.disposed) {
      throw new Error('AsyncDisposableStack has already been disposed.')
    }
  }
}

/**
 * Create a disposable from a cleanup callback.
 */
export function toDisposable(dispose: DisposeFn): Disposable {
  let disposed = false

  return {
    dispose() {
      if (disposed) return
      disposed = true
      dispose()
    }
  }
}

/**
 * Create an async disposable from a cleanup callback.
 */
export function toAsyncDisposable(dispose: AsyncDisposeFn): AsyncDisposable {
  let disposalPromise: Promise<void> | undefined

  return {
    disposeAsync() {
      if (disposalPromise) return disposalPromise

      disposalPromise = Promise.resolve()
        .then(dispose)
        .then(() => undefined)

      return disposalPromise
    }
  }
}

/**
 * Execute a callback with a synchronous disposable scope.
 */
export function using<T>(callback: (stack: DisposableStack) => T): T {
  const stack = new DisposableStack()

  try {
    return callback(stack)
  } finally {
    stack.dispose()
  }
}

/**
 * Execute a callback with an asynchronous disposable scope.
 */
export async function usingAsync<T>(callback: (stack: AsyncDisposableStack) => T | Promise<T>): Promise<T> {
  const stack = new AsyncDisposableStack()

  try {
    return await callback(stack)
  } finally {
    await stack.disposeAsync()
  }
}
