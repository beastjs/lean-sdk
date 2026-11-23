/**
 * Error thrown when a task is rejected because the queue has been disposed.
 */
export class QueueDisposedError extends Error {
  constructor(message = 'The queue has been disposed.') {
    super(message)
    this.name = 'QueueDisposedError'
  }
}

/**
 * Error thrown when an individual task is cancelled.
 */
export class QueueTaskCancelledError extends Error {
  constructor(message = 'The task was cancelled.') {
    super(message)
    this.name = 'QueueTaskCancelledError'
  }
}

/**
 * Internal representation of a queued task.
 *
 * We intentionally use unknown instead of a generic type here.
 * This allows different task result types to coexist in the same queue
 * without TypeScript generic variance problems.
 */
interface QueueTask {
  execute: (signal: AbortSignal) => unknown | Promise<unknown>
  controller: AbortController
  resolve: (value: unknown) => void
  reject: (reason?: unknown) => void
  externalSignal: AbortSignal | undefined
  abortListener: (() => void) | undefined
  settled: boolean
}

/**
 * Executes asynchronous tasks sequentially in FIFO order.
 *
 * Guarantees:
 * - Only one task executes at a time.
 * - Tasks execute in insertion order.
 * - A failed task does not interrupt the queue.
 * - Individual tasks can be cancelled.
 * - Disposing cancels pending tasks and aborts the active task.
 *
 * Cancellation is cooperative. Running tasks must respect their AbortSignal.
 */
export class SerialQueue {
  private readonly tasks: QueueTask[] = []

  private activeTask: QueueTask | null = null

  private isRunning = false
  private isDisposed = false

  private disposalError: QueueDisposedError | null = null

  /**
   * Adds a task to the queue.
   *
   * The returned promise resolves or rejects with the task's own result.
   *
   * @param task - The operation to execute.
   * @param options.signal - Optional external cancellation signal.
   */
  enqueue<T>(task: (signal: AbortSignal) => T | Promise<T>, options: { signal?: AbortSignal } = {}): Promise<T> {
    if (this.isDisposed) {
      return Promise.reject(this.disposalError ?? new QueueDisposedError())
    }

    if (options.signal?.aborted) {
      return Promise.reject(new QueueTaskCancelledError('The task was cancelled before enqueueing.'))
    }

    return new Promise<T>((resolve, reject) => {
      const controller = new AbortController()

      // Wrap the typed resolver so the internal queue can store
      // tasks with different result types safely.
      const queuedTask: QueueTask = {
        execute: task,
        controller,
        resolve: (value) => resolve(value as T),
        reject,
        externalSignal: options.signal,
        abortListener: undefined,
        settled: false
      }

      // Connect the external AbortSignal to this task's controller.
      if (options.signal) {
        const externalSignal = options.signal

        queuedTask.abortListener = () => {
          this.cancelTask(queuedTask, new QueueTaskCancelledError())
        }

        externalSignal.addEventListener('abort', queuedTask.abortListener, { once: true })
      }

      this.tasks.push(queuedTask)

      // Start processing if the queue is idle.
      void this.drain()
    })
  }

  /**
   * Permanently shuts down the queue.
   *
   * Pending tasks are rejected immediately.
   * The active task receives an abort signal.
   *
   * The active task is allowed to finish its underlying operation before
   * the queue considers it finished.
   */
  dispose(reason?: Error): void {
    if (this.isDisposed) return

    this.isDisposed = true

    this.disposalError =
      reason instanceof QueueDisposedError
        ? reason
        : new QueueDisposedError(reason?.message ?? 'The queue has been disposed.')

    // Reject all tasks that haven't started.
    for (const task of this.tasks.splice(0)) {
      this.cleanupTask(task)

      this.rejectTask(task, this.disposalError)
    }

    // Detach external cancellation and settle before notifying the active task.
    if (this.activeTask) {
      this.cleanupTask(this.activeTask)
      this.rejectTask(this.activeTask, this.disposalError)
      this.activeTask.controller.abort(this.disposalError)
    }
  }

  /**
   * Number of tasks currently executing or waiting.
   */
  get size(): number {
    return this.tasks.length + (this.activeTask ? 1 : 0)
  }

  /**
   * Number of tasks waiting to execute.
   */
  get pending(): number {
    return this.tasks.length
  }

  /**
   * Whether a task is currently executing.
   */
  get running(): boolean {
    return this.isRunning
  }

  /**
   * Whether the queue has been permanently disposed.
   */
  get disposed(): boolean {
    return this.isDisposed
  }

  /**
   * Processes queued tasks sequentially.
   *
   * Using a loop means a rejected task cannot poison the queue's
   * scheduling mechanism.
   */
  private async drain(): Promise<void> {
    if (this.isRunning || this.isDisposed) return

    this.isRunning = true

    try {
      while (this.tasks.length > 0 && !this.isDisposed) {
        const task = this.tasks.shift()

        if (!task || task.settled) continue

        this.activeTask = task

        try {
          // Wait for the task to finish before starting another.
          const result = await task.execute(task.controller.signal)

          this.resolveTask(task, result)
        } catch (error) {
          // A task failure only affects that task.
          this.rejectTask(task, error)
        } finally {
          this.cleanupTask(task)
          this.activeTask = null
        }
      }
    } finally {
      this.isRunning = false
      this.activeTask = null
    }
  }

  /**
   * Cancels an individual task without affecting unrelated tasks.
   */
  private cancelTask(task: QueueTask, error: QueueTaskCancelledError): void {
    if (task.settled) return

    // Remove it if it hasn't started yet.
    if (this.activeTask !== task) {
      const index = this.tasks.indexOf(task)

      if (index !== -1) {
        this.tasks.splice(index, 1)
      }
    }

    this.cleanupTask(task)
    this.rejectTask(task, error)
    task.controller.abort(error)
  }

  /**
   * Resolves a task exactly once.
   */
  private resolveTask(task: QueueTask, value: unknown): void {
    if (task.settled) return

    task.settled = true
    task.resolve(value)
  }

  /**
   * Rejects a task exactly once.
   */
  private rejectTask(task: QueueTask, error: unknown): void {
    if (task.settled) return

    task.settled = true
    task.reject(error)
  }

  /**
   * Removes external abort listeners to prevent memory leaks.
   */
  private cleanupTask(task: QueueTask): void {
    if (task.externalSignal && task.abortListener) {
      task.externalSignal.removeEventListener('abort', task.abortListener)
    }

    // Both fields explicitly support undefined under
    // exactOptionalPropertyTypes.
    task.abortListener = undefined
    task.externalSignal = undefined
  }
}
