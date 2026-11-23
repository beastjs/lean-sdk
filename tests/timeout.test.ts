import { describe, expect, it } from 'vitest'

import {
  AbortError,
  TimeoutError,
  createAbortError,
  createDeadline,
  delay,
  raceWithSignal,
  withTimeout
} from '../src/core/timeout'

describe('timeout utilities', () => {
  describe('TimeoutError', () => {
    it('contains timeout duration', () => {
      const error = new TimeoutError(1000)

      expect(error.name).toBe('TimeoutError')
      expect(error.timeoutMs).toBe(1000)
      expect(error.message).toContain('1000ms')
    })

    it('supports a custom message', () => {
      const error = new TimeoutError(100, 'Lean execution exceeded its limit')

      expect(error.message).toBe('Lean execution exceeded its limit')
    })

    it('is an Error instance', () => {
      expect(new TimeoutError(10)).toBeInstanceOf(Error)
    })
  })

  describe('AbortError', () => {
    it('creates a standard cancellation error', () => {
      const error = new AbortError()

      expect(error.name).toBe('AbortError')
      expect(error.message).toBe('Operation was aborted')
    })

    it('supports a custom message', () => {
      const error = new AbortError('Cancelled by user')

      expect(error.message).toBe('Cancelled by user')
    })
  })

  describe('createAbortError', () => {
    it('preserves an existing AbortError', () => {
      const error = new AbortError('Existing error')

      expect(createAbortError(error)).toBe(error)
    })

    it('converts Error reasons', () => {
      const error = createAbortError(new Error('Cancelled'))

      expect(error.message).toBe('Cancelled')
      expect(error.name).toBe('AbortError')
    })

    it('converts string reasons', () => {
      expect(createAbortError('Cancelled').message).toBe('Cancelled')
    })

    it('handles undefined reasons', () => {
      expect(createAbortError().message).toBe('Operation was aborted')
    })
  })

  describe('delay', () => {
    it('resolves after the requested duration', async () => {
      await expect(delay(5)).resolves.toBeUndefined()
    })

    it('resolves immediately with zero duration', async () => {
      await expect(delay(0)).resolves.toBeUndefined()
    })

    it('rejects when the signal is already aborted', async () => {
      const controller = new AbortController()

      controller.abort('Already cancelled')

      await expect(
        delay(100, {
          signal: controller.signal
        })
      ).rejects.toThrow('Already cancelled')
    })

    it('rejects when aborted during the delay', async () => {
      const controller = new AbortController()

      const promise = delay(1000, {
        signal: controller.signal
      })

      controller.abort('Cancelled')

      await expect(promise).rejects.toThrow('Cancelled')
    })

    it('rejects with AbortError', async () => {
      const controller = new AbortController()

      const promise = delay(1000, {
        signal: controller.signal
      })

      controller.abort()

      await expect(promise).rejects.toBeInstanceOf(AbortError)
    })

    it('rejects invalid durations', () => {
      expect(() => delay(-1)).toThrow(RangeError)
      expect(() => delay(Infinity)).toThrow(RangeError)
      expect(() => delay(NaN)).toThrow(RangeError)
    })
  })

  describe('withTimeout', () => {
    it('resolves when the operation completes in time', async () => {
      const result = await withTimeout(Promise.resolve(42), 100)

      expect(result).toBe(42)
    })

    it('supports async task factories', async () => {
      const result = await withTimeout(async () => 'success', 100)

      expect(result).toBe('success')
    })

    it('passes an AbortSignal to task factories', async () => {
      let receivedSignal!: AbortSignal

      await withTimeout((signal) => {
        receivedSignal = signal
        return 'success'
      }, 100)

      expect(receivedSignal).toBeInstanceOf(AbortSignal)
      expect(receivedSignal.aborted).toBe(false)
    })

    it('rejects when the operation exceeds the timeout', async () => {
      await expect(withTimeout(new Promise<void>(() => {}), 5)).rejects.toBeInstanceOf(TimeoutError)
    })

    it('aborts the task signal on timeout', async () => {
      let receivedSignal!: AbortSignal

      await expect(
        withTimeout((signal) => {
          receivedSignal = signal

          return new Promise<void>(() => {})
        }, 5)
      ).rejects.toBeInstanceOf(TimeoutError)

      expect(receivedSignal.aborted).toBe(true)
    })

    it('supports custom timeout messages', async () => {
      await expect(
        withTimeout(new Promise<void>(() => {}), 5, {
          message: 'Lean worker timed out'
        })
      ).rejects.toThrow('Lean worker timed out')
    })

    it('rejects when externally aborted', async () => {
      const controller = new AbortController()

      const promise = withTimeout(new Promise<void>(() => {}), 1000, {
        signal: controller.signal
      })

      controller.abort('Cancelled')

      await expect(promise).rejects.toBeInstanceOf(AbortError)
    })

    it('aborts the internal task signal on external cancellation', async () => {
      const controller = new AbortController()
      let taskSignal!: AbortSignal

      const promise = withTimeout(
        (signal) => {
          taskSignal = signal

          return new Promise<void>(() => {})
        },
        1000,
        {
          signal: controller.signal
        }
      )

      controller.abort()

      await expect(promise).rejects.toBeInstanceOf(AbortError)

      expect(taskSignal.aborted).toBe(true)
    })

    it('rejects immediately for an already aborted signal', async () => {
      const controller = new AbortController()

      controller.abort()

      await expect(
        withTimeout(Promise.resolve(42), 100, {
          signal: controller.signal
        })
      ).rejects.toBeInstanceOf(AbortError)
    })

    it('propagates operation errors', async () => {
      const error = new Error('Operation failed')

      await expect(withTimeout(Promise.reject(error), 100)).rejects.toBe(error)
    })

    it('propagates synchronous task factory errors', async () => {
      const error = new Error('Factory failed')

      await expect(
        withTimeout(() => {
          throw error
        }, 100)
      ).rejects.toBe(error)
    })

    it('rejects invalid timeout values', () => {
      expect(() => withTimeout(Promise.resolve(), -1)).toThrow(RangeError)

      expect(() => withTimeout(Promise.resolve(), Infinity)).toThrow(RangeError)
    })

    it('ignores operation completion after timeout', async () => {
      let resolveOperation!: (value: string) => void

      const operation = new Promise<string>((resolve) => {
        resolveOperation = resolve
      })

      const timed = withTimeout(operation, 5)

      await expect(timed).rejects.toBeInstanceOf(TimeoutError)

      resolveOperation('late result')

      // Late settlement does not alter the timeout result.
      await expect(timed).rejects.toBeInstanceOf(TimeoutError)
    })
  })

  describe('raceWithSignal', () => {
    it('resolves when the operation wins', async () => {
      const controller = new AbortController()

      await expect(raceWithSignal(Promise.resolve('success'), controller.signal)).resolves.toBe('success')
    })

    it('rejects when aborted', async () => {
      const controller = new AbortController()

      const promise = raceWithSignal(new Promise<void>(() => {}), controller.signal)

      controller.abort()

      await expect(promise).rejects.toBeInstanceOf(AbortError)
    })

    it('rejects immediately when already aborted', async () => {
      const controller = new AbortController()

      controller.abort()

      await expect(raceWithSignal(Promise.resolve('success'), controller.signal)).rejects.toBeInstanceOf(AbortError)
    })

    it('propagates operation errors', async () => {
      const controller = new AbortController()
      const error = new Error('Failure')

      await expect(raceWithSignal(Promise.reject(error), controller.signal)).rejects.toBe(error)
    })
  })

  describe('createDeadline', () => {
    it('creates a deadline', () => {
      const deadline = createDeadline(1000)

      expect(deadline.timeoutMs).toBe(1000)
      expect(deadline.expiresAt).toBeGreaterThan(Date.now())
    })

    it('reports remaining time', () => {
      const deadline = createDeadline(1000)

      expect(deadline.remaining()).toBeGreaterThan(0)
      expect(deadline.remaining()).toBeLessThanOrEqual(1000)
    })

    it('reports expiration', () => {
      const deadline = createDeadline(0)

      expect(deadline.isExpired()).toBe(true)
      expect(deadline.remaining()).toBe(0)
    })

    it('throws when expired', () => {
      const deadline = createDeadline(0)

      expect(() => deadline.throwIfExpired()).toThrow(TimeoutError)
    })

    it('does not throw while time remains', () => {
      const deadline = createDeadline(1000)

      expect(() => deadline.throwIfExpired()).not.toThrow()
    })

    it('rejects invalid timeout values', () => {
      expect(() => createDeadline(-1)).toThrow(RangeError)
      expect(() => createDeadline(NaN)).toThrow(RangeError)
      expect(() => createDeadline(Infinity)).toThrow(RangeError)
    })
  })
})
