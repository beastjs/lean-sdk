import { describe, expect, it, vi } from 'vitest'

import {
  abortController,
  abortPromise,
  abortSignalAny,
  abortSignalTimeout,
  abortable,
  createAbortController,
  createAbortError,
  createChildAbortController,
  createTimeoutSignal,
  getAbortReason,
  linkAbortSignals,
  onAbort,
  raceWithAbort,
  throwIfAborted,
  waitForAbort
} from '../src/core/abort'

describe('Abort utilities', () => {
  it('observes a rejected input promise when the signal is already aborted', async () => {
    const signal = AbortSignal.abort('cancelled')
    await expect(raceWithAbort(Promise.reject(new Error('operation failed')), signal)).rejects.toBe('cancelled')
  })

  it('skips an operation aborted before its scheduled start', async () => {
    const controller = new AbortController()
    const operation = vi.fn()
    const pending = abortable(operation, controller.signal)
    controller.abort('cancelled')

    await expect(pending).rejects.toBe('cancelled')
    expect(operation).not.toHaveBeenCalled()
  })

  it('removes source listeners when a linked controller is aborted directly', () => {
    const parent = new AbortController()
    const removeListener = vi.spyOn(parent.signal, 'removeEventListener')
    const child = createChildAbortController(parent.signal)

    child.abort('child cancelled')

    expect(removeListener).toHaveBeenCalledWith('abort', expect.any(Function))
    expect(parent.signal.aborted).toBe(false)
    expect(child.signal.reason).toBe('child cancelled')
  })

  it('creates standardized AbortErrors', () => {
    const error = createAbortError()

    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe('AbortError')
  })

  it('preserves Error reasons', () => {
    const reason = new Error('custom reason')

    expect(createAbortError(reason)).toBe(reason)
  })

  it('preserves non-error reasons as cause', () => {
    const error = createAbortError('cancelled')

    expect(error.name).toBe('AbortError')
    expect(error.cause).toBe('cancelled')
  })

  it('gets the abort reason', () => {
    const controller = new AbortController()

    expect(getAbortReason(controller.signal)).toBeUndefined()

    controller.abort('cancelled')

    expect(getAbortReason(controller.signal)).toBe('cancelled')
  })

  it('throws when already aborted', () => {
    const controller = new AbortController()

    controller.abort('cancelled')

    expect(() => throwIfAborted(controller.signal)).toThrow('cancelled')
  })

  it('does nothing when signal is active', () => {
    const controller = new AbortController()

    expect(() => throwIfAborted(controller.signal)).not.toThrow()
  })

  it('subscribes to abort', () => {
    const controller = new AbortController()
    let reason: unknown

    const subscription = onAbort(controller.signal, (value) => {
      reason = value
    })

    controller.abort('test')

    expect(reason).toBe('test')

    subscription.unsubscribe()
  })

  it('immediately invokes listener for an aborted signal', () => {
    const controller = new AbortController()

    controller.abort('already aborted')

    let reason: unknown

    onAbort(controller.signal, (value) => {
      reason = value
    })

    expect(reason).toBe('already aborted')
  })

  it('supports unsubscribing from abort', () => {
    const controller = new AbortController()

    let calls = 0

    const subscription = onAbort(controller.signal, () => calls++)

    subscription.unsubscribe()
    controller.abort()

    expect(calls).toBe(0)
  })

  it('links multiple signals', () => {
    const first = new AbortController()
    const second = new AbortController()

    const linked = linkAbortSignals(first.signal, second.signal)

    second.abort('second')

    expect(linked.signal.aborted).toBe(true)
    expect(linked.signal.reason).toBe('second')
  })

  it('aborts immediately if a source is already aborted', () => {
    const first = new AbortController()
    const second = new AbortController()

    first.abort('first')

    const linked = linkAbortSignals(first.signal, second.signal)

    expect(linked.signal.aborted).toBe(true)
    expect(linked.signal.reason).toBe('first')
  })

  it('supports abortSignalAny', () => {
    const first = new AbortController()
    const second = new AbortController()

    const signal = abortSignalAny(first.signal, second.signal)

    first.abort('first')

    expect(signal.aborted).toBe(true)
    expect(signal.reason).toBe('first')
  })

  it('creates a child controller', () => {
    const parent = new AbortController()

    const child = createChildAbortController(parent.signal)

    parent.abort('parent')

    expect(child.signal.aborted).toBe(true)
    expect(child.signal.reason).toBe('parent')
  })

  it('does not propagate child abortion to parent', () => {
    const parent = new AbortController()
    const child = createChildAbortController(parent.signal)

    child.abort('child')

    expect(parent.signal.aborted).toBe(false)
  })

  it('creates a timeout signal', async () => {
    const resource = createTimeoutSignal(10)

    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(resource.signal.aborted).toBe(true)
    expect(resource.signal.reason).toBeInstanceOf(Error)

    resource.dispose()
  })

  it('supports custom timeout reasons', async () => {
    const resource = createTimeoutSignal(5, {
      reason: 'custom timeout'
    })

    await new Promise((resolve) => setTimeout(resolve, 15))

    expect(resource.signal.aborted).toBe(true)
    expect(resource.signal.reason).toBe('custom timeout')
  })

  it('clears timeout when disposed', async () => {
    const resource = createTimeoutSignal(20)

    resource.dispose()

    await new Promise((resolve) => setTimeout(resolve, 30))

    expect(resource.signal.aborted).toBe(false)
  })

  it('rejects invalid timeout values', () => {
    expect(() => createTimeoutSignal(-1)).toThrow(RangeError)
    expect(() => createTimeoutSignal(Number.NaN)).toThrow(RangeError)
    expect(() => createTimeoutSignal(Infinity)).toThrow(RangeError)
  })

  it('creates abortSignalTimeout', async () => {
    const signal = abortSignalTimeout(5)

    await new Promise((resolve) => setTimeout(resolve, 15))

    expect(signal.aborted).toBe(true)
  })

  it('races promises against signals', async () => {
    const controller = new AbortController()

    const promise = new Promise<number>((resolve) => {
      setTimeout(() => resolve(42), 50)
    })

    const result = raceWithAbort(promise, controller.signal)

    controller.abort('cancelled')

    await expect(result).rejects.toBe('cancelled')
  })

  it('resolves raceWithAbort when promise wins', async () => {
    const controller = new AbortController()

    const result = await raceWithAbort(Promise.resolve(42), controller.signal)

    expect(result).toBe(42)
    expect(controller.signal.aborted).toBe(false)
  })

  it('rejects immediately for an already-aborted signal', async () => {
    const controller = new AbortController()

    controller.abort('cancelled')

    await expect(raceWithAbort(Promise.resolve(42), controller.signal)).rejects.toBe('cancelled')
  })

  it('supports abortable operations', async () => {
    const controller = new AbortController()

    const result = await abortable(async () => 42, controller.signal)

    expect(result).toBe(42)
  })

  it('aborts an abortable operation', async () => {
    const controller = new AbortController()

    const result = abortable(
      () =>
        new Promise<number>((resolve) => {
          setTimeout(() => resolve(42), 50)
        }),
      controller.signal
    )

    controller.abort('cancelled')

    await expect(result).rejects.toBe('cancelled')
  })

  it('does not start an already-aborted operation', async () => {
    const controller = new AbortController()

    controller.abort('cancelled')

    let calls = 0

    await expect(abortable(() => calls++, controller.signal)).rejects.toBe('cancelled')

    expect(calls).toBe(0)
  })

  it('creates an abort promise', async () => {
    const controller = new AbortController()

    const promise = abortPromise(controller.signal)

    controller.abort('cancelled')

    await expect(promise).rejects.toBe('cancelled')
  })

  it('waits for abort', async () => {
    const controller = new AbortController()

    const promise = waitForAbort(controller.signal)

    controller.abort('finished')

    await expect(promise).resolves.toBe('finished')
  })

  it('resolves immediately when already aborted', async () => {
    const controller = new AbortController()

    controller.abort('finished')

    await expect(waitForAbort(controller.signal)).resolves.toBe('finished')
  })

  it('aborts a controller safely', () => {
    const controller = new AbortController()

    expect(abortController(controller, 'cancelled')).toBe(true)
    expect(abortController(controller, 'again')).toBe(false)

    expect(controller.signal.reason).toBe('cancelled')
  })

  it('creates a controller with a parent signal', () => {
    const parent = new AbortController()

    const child = createAbortController({
      signal: parent.signal
    })

    parent.abort('parent')

    expect(child.signal.aborted).toBe(true)
    expect(child.signal.reason).toBe('parent')
  })

  it('creates a controller with a timeout', async () => {
    const controller = createAbortController({
      timeoutMs: 10
    })

    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(controller.signal.aborted).toBe(true)
  })

  it('creates a controller with parent and timeout', async () => {
    const parent = new AbortController()

    const child = createAbortController({
      signal: parent.signal,
      timeoutMs: 100
    })

    parent.abort('parent')

    expect(child.signal.aborted).toBe(true)
    expect(child.signal.reason).toBe('parent')
  })
})
