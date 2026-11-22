import { describe, expect, it } from 'vitest'
import { QueueDisposedError, QueueTaskCancelledError, SerialQueue } from '../src/core/queue'

describe('SerialQueue', () => {
  it('executes tasks in FIFO order', async () => {
    const queue = new SerialQueue()
    const order: number[] = []

    await Promise.all([
      queue.enqueue(() => order.push(1)),
      queue.enqueue(() => order.push(2)),
      queue.enqueue(() => order.push(3))
    ])

    expect(order).toEqual([1, 2, 3])
  })

  it('executes only one task at a time', async () => {
    const queue = new SerialQueue()

    let active = 0
    let maxActive = 0

    await Promise.all(
      Array.from({ length: 10 }, () =>
        queue.enqueue(async () => {
          active++

          maxActive = Math.max(maxActive, active)

          await Promise.resolve()

          active--
        })
      )
    )

    expect(maxActive).toBe(1)
  })

  it('returns task results', async () => {
    const queue = new SerialQueue()

    const result = await queue.enqueue(() => 42)
    const asyncResult = await queue.enqueue(async () => 'hello')

    expect(result).toBe(42)
    expect(asyncResult).toBe('hello')
  })

  it('continues after a task fails', async () => {
    const queue = new SerialQueue()
    const executed: number[] = []

    const first = queue.enqueue(() => {
      throw new Error('Task failed')
    })

    const second = queue.enqueue(() => {
      executed.push(2)
      return 'success'
    })

    await expect(first).rejects.toThrow('Task failed')
    await expect(second).resolves.toBe('success')

    expect(executed).toEqual([2])
  })

  it('cancels a pending task', async () => {
    const queue = new SerialQueue()
    const controller = new AbortController()

    let executed = false

    // Keep the first task running until we explicitly release it.
    let release!: () => void

    const blocker = queue.enqueue(
      () =>
        new Promise<void>((resolve) => {
          release = resolve
        })
    )

    const cancelled = queue.enqueue(
      () => {
        executed = true
      },
      { signal: controller.signal }
    )

    controller.abort()

    await expect(cancelled).rejects.toBeInstanceOf(QueueTaskCancelledError)

    release()
    await blocker

    expect(executed).toBe(false)
  })

  it('passes an AbortSignal to the task', async () => {
    const queue = new SerialQueue()

    let receivedSignal: AbortSignal | undefined

    await queue.enqueue((signal) => {
      receivedSignal = signal
    })

    expect(receivedSignal).toBeInstanceOf(AbortSignal)
  })

  it('rejects tasks after disposal', async () => {
    const queue = new SerialQueue()

    queue.dispose()

    await expect(queue.enqueue(() => 'hello')).rejects.toBeInstanceOf(QueueDisposedError)
  })

  it('disposes pending tasks', async () => {
    const queue = new SerialQueue()

    let release!: () => void

    const first = queue.enqueue(
      () =>
        new Promise<void>((resolve) => {
          release = resolve
        })
    )

    const second = queue.enqueue(() => 'second')

    queue.dispose()

    await expect(second).rejects.toBeInstanceOf(QueueDisposedError)

    release()

    await expect(first).rejects.toBeInstanceOf(QueueDisposedError)
  })

  it('disposes idempotently', () => {
    const queue = new SerialQueue()

    queue.dispose()
    queue.dispose()
    queue.dispose()

    expect(queue.disposed).toBe(true)
  })

  it('reports queue state correctly', async () => {
    const queue = new SerialQueue()

    expect(queue.size).toBe(0)
    expect(queue.pending).toBe(0)
    expect(queue.running).toBe(false)

    let release!: () => void

    const task = queue.enqueue(
      () =>
        new Promise<void>((resolve) => {
          release = resolve
        })
    )

    // Wait until the task is actively running.
    await Promise.resolve()

    expect(queue.running).toBe(true)
    expect(queue.size).toBe(1)
    expect(queue.pending).toBe(0)

    release()
    await task

    expect(queue.size).toBe(0)
    expect(queue.running).toBe(false)
  })
})
