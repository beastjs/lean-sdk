import { describe, expect, it } from 'vitest'
import { Deferred } from '../src/core/deferred'

describe('Deferred', () => {
  it('starts pending', () => {
    const deferred = new Deferred<number>()

    expect(deferred.state).toBe('pending')
    expect(deferred.isPending).toBe(true)
    expect(deferred.isSettled).toBe(false)
    expect(deferred.isResolved).toBe(false)
    expect(deferred.isRejected).toBe(false)
  })

  it('resolves with a value', async () => {
    const deferred = new Deferred<number>()

    deferred.resolve(42)

    expect(await deferred.promise).toBe(42)
  })

  it('tracks successful resolution', async () => {
    const deferred = new Deferred<string>()

    deferred.resolve('success')

    expect(deferred.isSettled).toBe(true)
    expect(deferred.state).toBe('resolving')

    await deferred.promise

    expect(deferred.state).toBe('resolved')
    expect(deferred.isResolved).toBe(true)
    expect(deferred.isRejected).toBe(false)
    expect(deferred.isPending).toBe(false)
  })

  it('rejects with an error', async () => {
    const deferred = new Deferred<number>()
    const error = new Error('Something went wrong')

    deferred.reject(error)

    await expect(deferred.promise).rejects.toBe(error)

    expect(deferred.state).toBe('rejected')
    expect(deferred.isRejected).toBe(true)
    expect(deferred.isResolved).toBe(false)
  })

  it('rejects with a non-error value', async () => {
    const deferred = new Deferred<number>()

    deferred.reject('failure')

    await expect(deferred.promise).rejects.toBe('failure')
  })

  it('ignores multiple resolve calls', async () => {
    const deferred = new Deferred<number>()

    deferred.resolve(1)
    deferred.resolve(2)
    deferred.resolve(3)

    expect(await deferred.promise).toBe(1)
  })

  it('ignores reject after resolve', async () => {
    const deferred = new Deferred<number>()

    deferred.resolve(10)
    deferred.reject(new Error('late rejection'))

    expect(await deferred.promise).toBe(10)
  })

  it('ignores resolve after reject', async () => {
    const deferred = new Deferred<number>()

    deferred.reject('first rejection')
    deferred.resolve(10)

    await expect(deferred.promise).rejects.toBe('first rejection')
  })

  it('ignores multiple reject calls', async () => {
    const deferred = new Deferred<number>()

    deferred.reject('first')
    deferred.reject('second')

    await expect(deferred.promise).rejects.toBe('first')
  })

  it('supports PromiseLike resolution', async () => {
    const deferred = new Deferred<number>()

    deferred.resolve(Promise.resolve(42))

    expect(await deferred.promise).toBe(42)

    expect(deferred.state).toBe('resolved')
  })

  it('tracks rejection from an adopted Promise', async () => {
    const deferred = new Deferred<number>()

    deferred.resolve(Promise.reject(new Error('adopted rejection')))

    await expect(deferred.promise).rejects.toThrow('adopted rejection')

    expect(deferred.state).toBe('rejected')
    expect(deferred.isRejected).toBe(true)
  })

  it('remains resolving while adopting a pending Promise', async () => {
    const deferred = new Deferred<number>()

    let resolveInner!: (value: number) => void

    const inner = new Promise<number>((resolve) => {
      resolveInner = resolve
    })

    deferred.resolve(inner)

    expect(deferred.state).toBe('resolving')
    expect(deferred.isSettled).toBe(true)

    resolveInner(99)

    expect(await deferred.promise).toBe(99)
    expect(deferred.state).toBe('resolved')
  })

  it('does not allow self-resolution', async () => {
    const deferred = new Deferred<number>()

    deferred.resolve(deferred.promise as unknown as PromiseLike<number>)

    await expect(deferred.promise).rejects.toThrow(TypeError)

    expect(deferred.state).toBe('rejected')
  })

  it('exposes the same promise instance', () => {
    const deferred = new Deferred<number>()

    expect(deferred.promise).toBe(deferred.promise)
  })

  it('supports independent deferred instances', async () => {
    const first = new Deferred<number>()
    const second = new Deferred<number>()

    first.resolve(1)
    second.resolve(2)

    await expect(first.promise).resolves.toBe(1)
    await expect(second.promise).resolves.toBe(2)
  })
})
