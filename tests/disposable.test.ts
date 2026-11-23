import { describe, expect, it } from 'vitest'

import {
  AsyncDisposableStack,
  DisposableError,
  DisposableStack,
  toAsyncDisposable,
  toDisposable,
  using,
  usingAsync
} from '../src/core/disposable'

describe('DisposableStack', () => {
  it('disposes resources in reverse order', () => {
    const calls: number[] = []
    const stack = new DisposableStack()

    stack.defer(() => calls.push(1))
    stack.defer(() => calls.push(2))
    stack.defer(() => calls.push(3))

    stack.dispose()

    expect(calls).toEqual([3, 2, 1])
  })

  it('is idempotent', () => {
    let calls = 0
    const stack = new DisposableStack()

    stack.defer(() => calls++)

    stack.dispose()
    stack.dispose()

    expect(calls).toBe(1)
    expect(stack.isDisposed).toBe(true)
    expect(stack.size).toBe(0)
  })

  it('continues disposal when a disposer throws', () => {
    const calls: number[] = []
    const stack = new DisposableStack()

    stack.defer(() => calls.push(1))
    stack.defer(() => {
      throw new Error('failure')
    })
    stack.defer(() => calls.push(3))

    expect(() => stack.dispose()).toThrow('failure')

    expect(calls).toEqual([3, 1])
    expect(stack.isDisposed).toBe(true)
  })

  it('aggregates multiple disposal errors', () => {
    const stack = new DisposableStack()

    stack.defer(() => {
      throw new Error('first')
    })

    stack.defer(() => {
      throw new Error('second')
    })

    let thrown: unknown

    try {
      stack.dispose()
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(DisposableError)
    expect((thrown as DisposableError).errors).toHaveLength(2)
  })

  it('supports resource registration', () => {
    let calls = 0

    const resource = {
      dispose() {
        calls++
      }
    }

    const stack = new DisposableStack()

    expect(stack.use(resource)).toBe(resource)

    stack.dispose()

    expect(calls).toBe(1)
  })

  it('supports callback registration through use', () => {
    let calls = 0

    const stack = new DisposableStack()

    stack.use(() => calls++)

    stack.dispose()

    expect(calls).toBe(1)
  })

  it('rejects registration after disposal', () => {
    const stack = new DisposableStack()

    stack.dispose()

    expect(() => stack.defer(() => {})).toThrow('DisposableStack has already been disposed.')
  })

  it('transfers ownership using move', () => {
    let calls = 0

    const original = new DisposableStack()
    original.defer(() => calls++)

    const moved = original.move()

    expect(original.isDisposed).toBe(true)
    expect(moved.isDisposed).toBe(false)

    original.dispose()
    expect(calls).toBe(0)

    moved.dispose()
    expect(calls).toBe(1)
  })

  it('provides a disposable wrapper', () => {
    let calls = 0

    const resource = toDisposable(() => calls++)

    resource.dispose()
    resource.dispose()

    expect(calls).toBe(1)
  })

  it('supports using()', () => {
    let calls = 0

    const result = using((stack) => {
      stack.defer(() => calls++)
      return 42
    })

    expect(result).toBe(42)
    expect(calls).toBe(1)
  })

  it('disposes when using callback throws', () => {
    let calls = 0

    expect(() =>
      using((stack) => {
        stack.defer(() => calls++)
        throw new Error('callback failure')
      })
    ).toThrow('callback failure')

    expect(calls).toBe(1)
  })
})

describe('AsyncDisposableStack', () => {
  it('disposes resources in reverse order sequentially', async () => {
    const calls: number[] = []
    const stack = new AsyncDisposableStack()

    stack.defer(async () => {
      await Promise.resolve()
      calls.push(1)
    })

    stack.defer(async () => {
      calls.push(2)
    })

    stack.defer(async () => {
      calls.push(3)
    })

    await stack.disposeAsync()

    expect(calls).toEqual([3, 2, 1])
  })

  it('is idempotent', async () => {
    let calls = 0

    const stack = new AsyncDisposableStack()

    stack.defer(async () => {
      calls++
    })

    await stack.disposeAsync()
    await stack.disposeAsync()

    expect(calls).toBe(1)
  })

  it('returns the same promise for concurrent disposal', async () => {
    const stack = new AsyncDisposableStack()

    stack.defer(async () => {
      await Promise.resolve()
    })

    const first = stack.disposeAsync()
    const second = stack.disposeAsync()

    expect(first).toBe(second)

    await first
  })

  it('continues disposal when a disposer rejects', async () => {
    const calls: number[] = []
    const stack = new AsyncDisposableStack()

    stack.defer(async () => calls.push(1))

    stack.defer(async () => {
      throw new Error('failure')
    })

    stack.defer(async () => calls.push(3))

    await expect(stack.disposeAsync()).rejects.toThrow('failure')

    expect(calls).toEqual([3, 1])
    expect(stack.isDisposed).toBe(true)
  })

  it('aggregates multiple async disposal errors', async () => {
    const stack = new AsyncDisposableStack()

    stack.defer(async () => {
      throw new Error('first')
    })

    stack.defer(async () => {
      throw new Error('second')
    })

    let thrown: unknown

    try {
      await stack.disposeAsync()
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(DisposableError)
    expect((thrown as DisposableError).errors).toHaveLength(2)
  })

  it('supports synchronous disposables', async () => {
    let calls = 0

    const stack = new AsyncDisposableStack()

    stack.use({
      dispose() {
        calls++
      }
    })

    await stack.disposeAsync()

    expect(calls).toBe(1)
  })

  it('supports asynchronous disposables', async () => {
    let calls = 0

    const stack = new AsyncDisposableStack()

    stack.use({
      async disposeAsync() {
        calls++
      }
    })

    await stack.disposeAsync()

    expect(calls).toBe(1)
  })

  it('supports callback registration through use', async () => {
    let calls = 0

    const stack = new AsyncDisposableStack()

    stack.use(async () => {
      calls++
    })

    await stack.disposeAsync()

    expect(calls).toBe(1)
  })

  it('rejects registration after disposal', async () => {
    const stack = new AsyncDisposableStack()

    await stack.disposeAsync()

    expect(() => stack.defer(() => {})).toThrow('AsyncDisposableStack has already been disposed.')
  })

  it('transfers ownership using move', async () => {
    let calls = 0

    const original = new AsyncDisposableStack()

    original.defer(async () => calls++)

    const moved = original.move()

    expect(original.isDisposed).toBe(true)
    expect(moved.isDisposed).toBe(false)

    await original.disposeAsync()
    expect(calls).toBe(0)

    await moved.disposeAsync()
    expect(calls).toBe(1)
  })

  it('provides an async disposable wrapper', async () => {
    let calls = 0

    const resource = toAsyncDisposable(async () => calls++)

    await resource.disposeAsync()
    await resource.disposeAsync()

    expect(calls).toBe(1)
  })

  it('supports usingAsync()', async () => {
    let calls = 0

    const result = await usingAsync(async (stack) => {
      stack.defer(async () => calls++)
      return 42
    })

    expect(result).toBe(42)
    expect(calls).toBe(1)
  })

  it('disposes when usingAsync callback throws', async () => {
    let calls = 0

    await expect(
      usingAsync(async (stack) => {
        stack.defer(async () => calls++)
        throw new Error('callback failure')
      })
    ).rejects.toThrow('callback failure')

    expect(calls).toBe(1)
  })
})
