/**
 * Deferred<T>
 *
 * A Promise whose resolve/reject functions are externally accessible.
 *
 * Features:
 * - External resolve/reject.
 * - Settlement protection (first settlement wins).
 * - PromiseLike support.
 * - Settlement state tracking.
 * - Idempotent settlement.
 */

export type DeferredState = 'pending' | 'resolving' | 'resolved' | 'rejected'

export class Deferred<T> {
  private stateValue: DeferredState = 'pending'

  private settlementLocked = false

  private resolvePromise!: (value: T | PromiseLike<T>) => void

  private rejectPromise!: (reason?: unknown) => void

  readonly promise: Promise<T>

  constructor() {
    this.promise = new Promise<T>((resolve, reject) => {
      this.resolvePromise = resolve
      this.rejectPromise = reject
    })

    // Track actual Promise settlement, including adopted thenables.
    this.promise.then(
      () => {
        this.stateValue = 'resolved'
      },
      () => {
        this.stateValue = 'rejected'
      }
    )
  }

  /**
   * Resolve the deferred.
   *
   * The first settlement attempt wins.
   * Resolving with a PromiseLike is supported.
   */
  resolve(value: T | PromiseLike<T>): void {
    if (this.settlementLocked) {
      return
    }

    this.settlementLocked = true
    this.stateValue = 'resolving'

    this.resolvePromise(value)
  }

  /**
   * Reject the deferred.
   *
   * The first settlement attempt wins.
   */
  reject(reason?: unknown): void {
    if (this.settlementLocked) {
      return
    }

    this.settlementLocked = true
    this.stateValue = 'rejected'

    this.rejectPromise(reason)
  }

  /**
   * Current settlement state.
   */
  get state(): DeferredState {
    return this.stateValue
  }

  /**
   * Whether settlement has been initiated.
   *
   * A resolving thenable may still be pending internally.
   */
  get isSettled(): boolean {
    return this.settlementLocked
  }

  /**
   * Whether the deferred has been resolved successfully.
   */
  get isResolved(): boolean {
    return this.stateValue === 'resolved'
  }

  /**
   * Whether the deferred has been rejected.
   */
  get isRejected(): boolean {
    return this.stateValue === 'rejected'
  }

  /**
   * Whether settlement has not yet been initiated.
   */
  get isPending(): boolean {
    return !this.settlementLocked
  }
}
