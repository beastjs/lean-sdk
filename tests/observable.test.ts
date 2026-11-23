import { describe, expect, it, vi } from 'vitest'

import { Observable, filterObservable, mapObservable, observable, readonlyObservable } from '../src/core/observable'

describe('Observable', () => {
  it('detaches abort listeners when disposed during notification', () => {
    const source = observable(0)
    const controller = new AbortController()
    const removeListener = vi.spyOn(controller.signal, 'removeEventListener')
    const listener = vi.fn()

    source.subscribe(() => source.dispose())
    const subscription = source.subscribe(listener, { signal: controller.signal })

    source.set(1)

    expect(subscription.closed).toBe(true)
    expect(source.subscriberCount).toBe(0)
    expect(removeListener).toHaveBeenCalledWith('abort', subscription.unsubscribe)
    expect(listener).not.toHaveBeenCalled()
  })

  it('stores the initial value', () => {
    const state = new Observable(10)

    expect(state.value).toBe(10)
  })

  it('updates its value', () => {
    const state = new Observable(10)

    expect(state.set(20)).toBe(true)
    expect(state.value).toBe(20)
  })

  it('does not notify when the value is equal', () => {
    let calls = 0

    const state = new Observable(10)

    state.subscribe(() => calls++)

    expect(state.set(10)).toBe(false)
    expect(calls).toBe(0)
  })

  it('supports custom equality', () => {
    let calls = 0

    const state = new Observable(
      { count: 1 },
      {
        equalityFn: (a, b) => a.count === b.count
      }
    )

    state.subscribe(() => calls++)

    expect(state.set({ count: 1 })).toBe(false)
    expect(state.set({ count: 2 })).toBe(true)

    expect(calls).toBe(1)
  })

  it('notifies listeners with current and previous values', () => {
    const state = new Observable(1)

    const changes: [number, number][] = []

    state.subscribe((value, previous) => {
      changes.push([value, previous])
    })

    state.set(2)
    state.set(3)

    expect(changes).toEqual([
      [2, 1],
      [3, 2]
    ])
  })

  it('supports update', () => {
    const state = new Observable(10)

    state.update((value) => value + 5)

    expect(state.value).toBe(15)
  })

  it('supports unsubscribe', () => {
    let calls = 0

    const state = new Observable(0)

    const subscription = state.subscribe(() => calls++)

    state.set(1)
    subscription.unsubscribe()
    state.set(2)

    expect(calls).toBe(1)
    expect(subscription.closed).toBe(true)
  })

  it('supports immediate subscriptions', () => {
    const state = new Observable(42)

    const changes: [number, number][] = []

    state.subscribe(
      (value, previous) => {
        changes.push([value, previous])
      },
      { immediate: true }
    )

    expect(changes).toEqual([[42, 42]])
  })

  it('supports AbortSignal subscriptions', () => {
    const controller = new AbortController()

    let calls = 0

    const state = new Observable(0)

    state.subscribe(() => calls++, {
      signal: controller.signal
    })

    state.set(1)
    controller.abort()
    state.set(2)

    expect(calls).toBe(1)
  })

  it('does not subscribe with an already-aborted signal', () => {
    const controller = new AbortController()

    controller.abort()

    const state = new Observable(0)

    const subscription = state.subscribe(() => {}, {
      signal: controller.signal
    })

    expect(subscription.closed).toBe(true)
    expect(state.subscriberCount).toBe(0)
  })

  it('supports reentrant updates', () => {
    const state = new Observable(0)

    const first: number[] = []
    const second: number[] = []

    state.subscribe((value) => {
      first.push(value)

      if (value === 1) {
        state.set(2)
      }
    })

    state.subscribe((value) => {
      second.push(value)
    })

    state.set(1)

    expect(first).toEqual([1, 2])
    expect(second).toEqual([1, 2])
    expect(state.value).toBe(2)
  })

  it('handles listener removal during notification', () => {
    const state = new Observable(0)

    const calls: string[] = []

    let targetSubscription: { unsubscribe(): void } | undefined

    state.subscribe(() => {
      calls.push('remover')
      targetSubscription?.unsubscribe()
    })

    targetSubscription = state.subscribe(() => {
      calls.push('target')
    })

    state.set(1)

    expect(calls).toEqual(['remover'])
  })

  it('handles listeners added during notification', () => {
    const state = new Observable(0)

    const calls: string[] = []

    state.subscribe(() => {
      calls.push('first')

      state.subscribe(() => {
        calls.push('late')
      })
    })

    state.set(1)

    expect(calls).toEqual(['first'])
  })

  it('isolates listener errors', () => {
    const errors: unknown[] = []
    const calls: number[] = []

    const state = new Observable(0, {
      onListenerError: (error) => errors.push(error)
    })

    state.subscribe(() => {
      throw new Error('listener failure')
    })

    state.subscribe((value) => {
      calls.push(value)
    })

    state.set(1)

    expect(errors).toHaveLength(1)
    expect(calls).toEqual([1])
  })

  it('isolates error handler errors', () => {
    const calls: number[] = []

    const state = new Observable(0, {
      onListenerError: () => {
        throw new Error('handler failure')
      }
    })

    state.subscribe(() => {
      throw new Error('listener failure')
    })

    state.subscribe((value) => {
      calls.push(value)
    })

    expect(() => state.set(1)).not.toThrow()
    expect(calls).toEqual([1])
  })

  it('supports readonly views', () => {
    const state = new Observable(10)
    const view = state.asReadonly()

    expect(view.value).toBe(10)

    state.set(20)

    expect(view.value).toBe(20)
  })

  it('supports readonlyObservable helper', () => {
    const state = observable(1)
    const view = readonlyObservable(state)

    expect(view.value).toBe(1)
  })

  it('supports subscriber introspection', () => {
    const state = new Observable(0)

    expect(state.subscriberCount).toBe(0)

    const a = state.subscribe(() => {})
    const b = state.subscribe(() => {})

    expect(state.subscriberCount).toBe(2)

    a.unsubscribe()

    expect(state.subscriberCount).toBe(1)

    b.unsubscribe()

    expect(state.subscriberCount).toBe(0)
  })

  it('disposes all listeners', () => {
    const state = new Observable(0)

    state.subscribe(() => {})
    state.subscribe(() => {})

    state.dispose()

    expect(state.disposed).toBe(true)
    expect(state.subscriberCount).toBe(0)
  })

  it('is idempotent when disposed', () => {
    const state = new Observable(0)

    state.dispose()
    state.dispose()

    expect(state.disposed).toBe(true)
  })

  it('rejects updates after disposal', () => {
    const state = new Observable(0)

    state.dispose()

    expect(() => state.set(1)).toThrow('Observable has been disposed.')
  })

  it('rejects subscriptions after disposal', () => {
    const state = new Observable(0)

    state.dispose()

    expect(() => state.subscribe(() => {})).toThrow('Observable has been disposed.')
  })

  it('supports mapObservable', () => {
    const source = new Observable(2)

    const mapped = mapObservable(source, (value) => value * 2)

    expect(mapped.observable.value).toBe(4)

    source.set(5)

    expect(mapped.observable.value).toBe(10)

    mapped.dispose()

    source.set(10)

    expect(mapped.observable.value).toBe(10)
    expect(mapped.observable.disposed).toBe(true)
  })

  it('supports filterObservable', () => {
    const source = new Observable(1)

    const filtered = filterObservable(source, (value) => value % 2 === 0)

    expect(filtered.observable.value).toBe(1)

    source.set(2)

    expect(filtered.observable.value).toBe(2)

    source.set(3)

    expect(filtered.observable.value).toBe(2)

    filtered.dispose()
  })

  it('supports the observable factory', () => {
    const state = observable('hello')

    expect(state.value).toBe('hello')
  })
})
