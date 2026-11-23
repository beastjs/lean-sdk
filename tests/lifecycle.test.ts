import { describe, expect, it, vi } from 'vitest'

import { LifecycleManager, LifecycleWaitCancelledError } from '../src/core/lifecycle'

describe('LifecycleManager', () => {
  it('unsubscribes a cancelled readiness wait and clears its timeout', async () => {
    vi.useFakeTimers()
    try {
      const lifecycle = new LifecycleManager<string>()
      const unsubscribe = vi.fn()
      vi.spyOn(lifecycle, 'subscribe').mockReturnValue(unsubscribe)
      const controller = new AbortController()

      const waiting = lifecycle.waitUntilReady({ signal: controller.signal, timeoutMs: 60_000 })
      controller.abort()

      await expect(waiting).rejects.toBeInstanceOf(LifecycleWaitCancelledError)
      expect(unsubscribe).toHaveBeenCalledTimes(1)
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('shares initialization with callers inside lifecycle subscribers', async () => {
    const lifecycle = new LifecycleManager<string>()
    let reentrant: Promise<string> | undefined
    const otherInitializer = vi.fn(() => 'other')

    lifecycle.subscribe(({ current }) => {
      if (current === 'initializing') reentrant = lifecycle.initialize(otherInitializer)
    })

    const initialization = lifecycle.initialize(() => 'resource')

    expect(reentrant).toBe(initialization)
    await expect(initialization).resolves.toBe('resource')
    expect(otherInitializer).not.toHaveBeenCalled()
  })

  it('shares disposal with callers inside lifecycle subscribers', async () => {
    const lifecycle = new LifecycleManager<string>()
    let reentrant: Promise<void> | undefined
    const otherDisposer = vi.fn()

    lifecycle.subscribe(({ current }) => {
      if (current === 'disposing') reentrant = lifecycle.dispose(otherDisposer)
    })

    const disposal = lifecycle.dispose()

    expect(reentrant).toBe(disposal)
    await disposal
    expect(otherDisposer).not.toHaveBeenCalled()
  })

  it('starts in idle state', () => {
    const lifecycle = new LifecycleManager<string>()

    expect(lifecycle.state).toBe('idle')
    expect(lifecycle.ready).toBe(false)
    expect(lifecycle.initializing).toBe(false)
    expect(lifecycle.disposed).toBe(false)
    expect(lifecycle.value).toBeUndefined()
  })

  it('initializes successfully', async () => {
    const lifecycle = new LifecycleManager<string>()

    const result = await lifecycle.initialize(async () => 'Lean Runtime')

    expect(result).toBe('Lean Runtime')
    expect(lifecycle.state).toBe('ready')
    expect(lifecycle.ready).toBe(true)
    expect(lifecycle.value).toBe('Lean Runtime')
  })

  it('only initializes once', async () => {
    const lifecycle = new LifecycleManager<number>()

    let initializationCount = 0

    const initializer = async () => {
      initializationCount++
      return 42
    }

    const first = lifecycle.initialize(initializer)
    const second = lifecycle.initialize(initializer)

    const [firstResult, secondResult] = await Promise.all([first, second])

    expect(firstResult).toBe(42)
    expect(secondResult).toBe(42)
    expect(initializationCount).toBe(1)
  })

  it('returns the existing resource after initialization', async () => {
    const lifecycle = new LifecycleManager<string>()

    let count = 0

    await lifecycle.initialize(() => {
      count++
      return 'ready'
    })

    const result = await lifecycle.initialize(() => {
      count++
      return 'another value'
    })

    expect(result).toBe('ready')
    expect(count).toBe(1)
  })

  it('transitions through initializing and ready', async () => {
    const lifecycle = new LifecycleManager<string>()
    const states: string[] = []

    lifecycle.subscribe((event) => {
      states.push(event.current)
    })

    await lifecycle.initialize(() => 'resource')

    expect(states).toEqual(['initializing', 'ready'])
  })

  it('notifies subscribers of state changes', async () => {
    const lifecycle = new LifecycleManager<number>()
    const events: Array<{
      previous: string
      current: string
    }> = []

    lifecycle.subscribe((event) => {
      events.push({
        previous: event.previous,
        current: event.current
      })
    })

    await lifecycle.initialize(() => 10)

    expect(events).toEqual([
      { previous: 'idle', current: 'initializing' },
      { previous: 'initializing', current: 'ready' }
    ])
  })

  it('allows unsubscribing from state changes', async () => {
    const lifecycle = new LifecycleManager<string>()
    let count = 0

    const unsubscribe = lifecycle.subscribe(() => {
      count++
    })

    unsubscribe()

    await lifecycle.initialize(() => 'ready')

    expect(count).toBe(0)
  })

  it('waits until initialization is ready', async () => {
    const lifecycle = new LifecycleManager<string>()

    let release!: (value: string) => void

    const initialization = lifecycle.initialize(
      () =>
        new Promise<string>((resolve) => {
          release = resolve
        })
    )

    const waiting = lifecycle.waitUntilReady()

    release('initialized')

    await expect(waiting).resolves.toBe('initialized')
    await initialization
  })

  it('rejects readiness waiting when initialization fails', async () => {
    const lifecycle = new LifecycleManager<string>()

    let rejectInitialization!: (error: Error) => void

    const initialization = lifecycle.initialize(
      () =>
        new Promise<string>((_, reject) => {
          rejectInitialization = reject
        })
    )

    const waiting = lifecycle.waitUntilReady()

    // Attach rejection handlers BEFORE triggering the failure.
    const initializationAssertion = expect(initialization).rejects.toThrow('Initialization failed')

    const waitingAssertion = expect(waiting).rejects.toThrow('Initialization failed')

    rejectInitialization(new Error('Initialization failed'))

    await initializationAssertion
    await waitingAssertion

    expect(lifecycle.state).toBe('error')
    expect(lifecycle.error?.message).toBe('Initialization failed')
  })

  it('supports cancellation while waiting', async () => {
    const lifecycle = new LifecycleManager<string>()
    const controller = new AbortController()

    const waiting = lifecycle.waitUntilReady({
      signal: controller.signal
    })

    controller.abort()

    await expect(waiting).rejects.toBeInstanceOf(LifecycleWaitCancelledError)
  })

  it('rejects waiting when the signal is already aborted', async () => {
    const lifecycle = new LifecycleManager<string>()
    const controller = new AbortController()

    controller.abort()

    await expect(
      lifecycle.waitUntilReady({
        signal: controller.signal
      })
    ).rejects.toBeInstanceOf(LifecycleWaitCancelledError)
  })

  it('throws when assertReady is called before initialization', () => {
    const lifecycle = new LifecycleManager<string>()

    expect(() => lifecycle.assertReady()).toThrow('Lifecycle is not ready')
  })

  it('allows assertReady after initialization', async () => {
    const lifecycle = new LifecycleManager<string>()

    await lifecycle.initialize(() => 'ready')

    expect(() => lifecycle.assertReady()).not.toThrow()
  })

  it('disposes the initialized resource', async () => {
    const lifecycle = new LifecycleManager<string>()

    await lifecycle.initialize(() => 'resource')

    let disposedResource: string | undefined

    await lifecycle.dispose((resource) => {
      disposedResource = resource
    })

    expect(disposedResource).toBe('resource')
    expect(lifecycle.state).toBe('disposed')
    expect(lifecycle.disposed).toBe(true)
    expect(lifecycle.value).toBeUndefined()
  })

  it('disposes idempotently', async () => {
    const lifecycle = new LifecycleManager<string>()

    await lifecycle.initialize(() => 'resource')

    let disposeCount = 0

    await Promise.all([
      lifecycle.dispose(() => {
        disposeCount++
      }),
      lifecycle.dispose(() => {
        disposeCount++
      })
    ])

    expect(disposeCount).toBe(1)
    expect(lifecycle.state).toBe('disposed')
  })

  it('does not allow initialization after disposal', async () => {
    const lifecycle = new LifecycleManager<string>()

    await lifecycle.dispose()

    await expect(lifecycle.initialize(() => 'resource')).rejects.toThrow('Cannot initialize a disposed lifecycle')
  })

  it('aborts initialization when disposed', async () => {
    const lifecycle = new LifecycleManager<string>()

    let wasAborted = false

    const initialization = lifecycle.initialize(
      (signal) =>
        new Promise<string>((_, reject) => {
          signal.addEventListener(
            'abort',
            () => {
              wasAborted = true
              reject(new Error('Aborted'))
            },
            { once: true }
          )

          // Handle the possibility that the signal is already aborted.
          if (signal.aborted) {
            wasAborted = true
            reject(new Error('Aborted'))
          }
        })
    )

    const disposal = lifecycle.dispose()

    await expect(initialization).rejects.toThrow()
    await disposal

    expect(wasAborted).toBe(true)
    expect(lifecycle.state).toBe('disposed')
  })

  it('disposes a resource returned after initialization was cancelled', async () => {
    const lifecycle = new LifecycleManager<string>()

    let release!: (value: string) => void
    let disposedResource: string | undefined

    const initialization = lifecycle.initialize(
      () =>
        new Promise<string>((resolve) => {
          release = resolve
        })
    )

    const disposal = lifecycle.dispose((resource) => {
      disposedResource = resource
    })

    release('resource')

    // Initialization is cancelled by disposal.
    await expect(initialization).rejects.toThrow()

    await disposal

    expect(disposedResource).toBe('resource')
    expect(lifecycle.state).toBe('disposed')
  })

  it('notifies subscribers about disposal', async () => {
    const lifecycle = new LifecycleManager<string>()
    const states: string[] = []

    lifecycle.subscribe((event) => {
      states.push(event.current)
    })

    await lifecycle.initialize(() => 'resource')
    await lifecycle.dispose()

    expect(states).toEqual(['initializing', 'ready', 'disposing', 'disposed'])
  })

  it('does not allow subscriber exceptions to break transitions', async () => {
    const lifecycle = new LifecycleManager<string>()

    lifecycle.subscribe(() => {
      throw new Error('Subscriber failed')
    })

    await expect(lifecycle.initialize(() => 'resource')).resolves.toBe('resource')

    expect(lifecycle.state).toBe('ready')
  })
})
