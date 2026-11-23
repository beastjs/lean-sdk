import { describe, expect, it } from 'vitest'
import * as sdk from '../index.js'
import * as core from '../src/core/index.js'

describe('SDK development environment', () => {
  it('runs the test framework correctly', () => {
    expect(true).toBe(true)
  })

  it('exposes each core module through the SDK entry point', () => {
    const exports = [
      'AsyncDisposableStack', 'Cache', 'Deferred', 'EventEmitter', 'LeanMathError', 'LifecycleManager',
      'Observable', 'RateLimiter', 'SerialQueue', 'StateStore', 'abortable', 'memoizeAsync', 'withTimeout'
    ] as const

    for (const name of exports) {
      expect(sdk[name]).toBeTypeOf('function')
      expect(sdk[name]).toBe(core[name])
    }

    const reason = new Error('cancelled')
    expect(sdk.createAbortError(reason)).toBe(reason)
    expect(sdk.createTimeoutAbortError(reason)).toBeInstanceOf(sdk.AbortError)
  })
})
