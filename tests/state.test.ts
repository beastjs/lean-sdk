import { describe, expect, it } from 'vitest'

import { StateStore, createState } from '../src/core/state'

describe('StateStore', () => {
  it('stores initial state', () => {
    const store = new StateStore({ count: 0 })

    expect(store.getState()).toEqual({ count: 0 })
  })

  it('replaces state', () => {
    const store = new StateStore({ count: 0 })

    store.setState({ count: 10 })

    expect(store.getState()).toEqual({ count: 10 })
  })

  it('supports updater functions', () => {
    const store = new StateStore({ count: 1 })

    store.setState((state) => ({
      count: state.count + 1
    }))

    expect(store.getState()).toEqual({ count: 2 })
  })

  it('supports update', () => {
    const store = new StateStore(10)

    store.update((value) => value * 2)

    expect(store.getState()).toBe(20)
  })

  it('supports patch', () => {
    const store = new StateStore({
      count: 1,
      name: 'test'
    })

    store.patch({ count: 2 })

    expect(store.getState()).toEqual({
      count: 2,
      name: 'test'
    })
  })

  it('supports patch callback', () => {
    const store = new StateStore({
      count: 1,
      name: 'test'
    })

    store.patch((state) => ({
      count: state.count + 1
    }))

    expect(store.getState()).toEqual({
      count: 2,
      name: 'test'
    })
  })

  it('rejects patching primitive states', () => {
    const store = createState<number>(42)

    expect(() => {
      ;(store.patch as (patch: unknown) => number)({})
    }).toThrow('patch() requires a non-null, non-array object state.')

    expect(store.getState()).toBe(42)
  })

  it('notifies subscribers on updates', () => {
    const store = new StateStore(0)

    const changes: [number, number][] = []

    store.subscribe((state, previous) => {
      changes.push([state, previous])
    })

    store.setState(1)
    store.setState(2)

    expect(changes).toEqual([
      [1, 0],
      [2, 1]
    ])
  })

  it('supports unsubscribe', () => {
    const store = new StateStore(0)

    let calls = 0

    const subscription = store.subscribe(() => calls++)

    store.setState(1)
    subscription.unsubscribe()
    store.setState(2)

    expect(calls).toBe(1)
    expect(subscription.closed).toBe(true)
  })

  it('supports signal-based subscriptions', () => {
    const controller = new AbortController()

    const store = new StateStore(0)

    let calls = 0

    store.subscribe(() => calls++, {
      signal: controller.signal
    })

    store.setState(1)
    controller.abort()
    store.setState(2)

    expect(calls).toBe(1)
  })

  it('supports immediate subscriptions', () => {
    const store = new StateStore(10)

    const values: number[] = []

    store.subscribe((value) => values.push(value), {
      immediate: true
    })

    expect(values).toEqual([10])
  })

  it('supports selectors', () => {
    const store = new StateStore({
      count: 0,
      name: 'test'
    })

    expect(store.select((state) => state.count)).toBe(0)
  })

  it('subscribes selectively', () => {
    const store = new StateStore({
      count: 0,
      name: 'test'
    })

    const values: number[] = []

    store.subscribeSelector(
      (state) => state.count,
      (value) => values.push(value)
    )

    store.patch({ name: 'changed' })
    store.patch({ count: 1 })
    store.patch({ count: 2 })

    expect(values).toEqual([1, 2])
  })

  it('supports selector equality', () => {
    const store = new StateStore({
      count: 0
    })

    let calls = 0

    store.subscribeSelector(
      (state) => state.count % 2,
      () => calls++,
      {
        equalityFn: Object.is
      }
    )

    store.setState({ count: 2 })
    store.setState({ count: 4 })
    store.setState({ count: 5 })

    expect(calls).toBe(1)
  })

  it('supports immediate selector subscriptions', () => {
    const store = new StateStore({
      count: 5
    })

    const values: [number, number][] = []

    store.subscribeSelector(
      (state) => state.count,
      (value, previous) => values.push([value, previous]),
      {
        immediate: true
      }
    )

    expect(values).toEqual([[5, 5]])
  })

  it('supports aborting selector subscriptions', () => {
    const controller = new AbortController()

    const store = new StateStore({
      count: 0
    })

    let calls = 0

    store.subscribeSelector(
      (state) => state.count,
      () => calls++,
      {
        signal: controller.signal
      }
    )

    store.setState({ count: 1 })
    controller.abort()
    store.setState({ count: 2 })

    expect(calls).toBe(1)
  })

  it('supports transactions', () => {
    const store = new StateStore({
      count: 0
    })

    const changes: number[] = []

    store.subscribe((state) => {
      changes.push(state.count)
    })

    store.transaction((state) => {
      state.patch({ count: 1 })
      state.patch({ count: 2 })
      state.patch({ count: 3 })
    })

    expect(store.getState()).toEqual({ count: 3 })
    expect(changes).toEqual([3])
  })

  it('does not publish intermediate transaction states', () => {
    const store = new StateStore(0)

    const values: number[] = []

    store.subscribe((value) => values.push(value))

    store.transaction((state) => {
      state.setState(1)
      state.setState(2)
      state.setState(3)
    })

    expect(values).toEqual([3])
  })

  it('supports nested transactions', () => {
    const store = new StateStore(0)

    const values: number[] = []

    store.subscribe((value) => values.push(value))

    store.transaction((state) => {
      state.setState(1)

      state.transaction((nested) => {
        nested.setState(2)
      })

      state.setState(3)
    })

    expect(store.getState()).toBe(3)
    expect(values).toEqual([3])
  })

  it('rolls back failed transactions', () => {
    const store = new StateStore(0)

    const values: number[] = []

    store.subscribe((value) => values.push(value))

    expect(() => {
      store.transaction((state) => {
        state.setState(1)
        state.setState(2)

        throw new Error('rollback')
      })
    }).toThrow('rollback')

    expect(store.getState()).toBe(0)
    expect(values).toEqual([])
  })

  it('rolls back a nested transaction to its savepoint', () => {
    const store = new StateStore(0)

    store.transaction((state) => {
      state.setState(1)

      try {
        state.transaction((nested) => {
          nested.setState(2)
          throw new Error('nested rollback')
        })
      } catch {}

      expect(state.getState()).toBe(1)

      state.setState(3)
    })

    expect(store.getState()).toBe(3)
  })

  it('supports transaction return values', () => {
    const store = new StateStore(0)

    const result = store.transaction((state) => {
      state.setState(5)
      return 'committed'
    })

    expect(result).toBe('committed')
    expect(store.getState()).toBe(5)
  })

  it('exposes readonly observable state', () => {
    const store = new StateStore(10)

    expect(store.observable.value).toBe(10)

    store.setState(20)

    expect(store.observable.value).toBe(20)
  })

  it('supports disposal', () => {
    const store = new StateStore(0)

    store.dispose()

    expect(store.disposed).toBe(true)
  })

  it('is idempotent when disposed', () => {
    const store = new StateStore(0)

    store.dispose()
    store.dispose()

    expect(store.disposed).toBe(true)
  })

  it('rejects updates after disposal', () => {
    const store = new StateStore(0)

    store.dispose()

    expect(() => store.setState(1)).toThrow('StateStore has been disposed.')
  })

  it('rejects subscriptions after disposal', () => {
    const store = new StateStore(0)

    store.dispose()

    expect(() => store.subscribe(() => {})).toThrow('StateStore has been disposed.')
  })

  it('supports the factory', () => {
    const store = createState({ count: 1 })

    expect(store.getState()).toEqual({ count: 1 })
  })
})
