import { describe, expect, it } from 'vitest'
import { memoize, memoizeAsync } from '../src/core/memoize'

describe('memoize', () => {
  it('caches function results', () => {
    let calls = 0

    const fn = memoize((value: number) => {
      calls++
      return value * 2
    })

    expect(fn(2)).toBe(4)
    expect(fn(2)).toBe(4)
    expect(fn(3)).toBe(6)

    expect(calls).toBe(2)
  })

  it('tracks hits and misses', () => {
    const fn = memoize((value: number) => value * 2)

    fn(1)
    fn(1)
    fn(2)

    expect(fn.stats.hits).toBe(1)
    expect(fn.stats.misses).toBe(2)
    expect(fn.stats.size).toBe(2)
  })

  it('caches undefined results', () => {
    let calls = 0

    const fn = memoize(() => {
      calls++
      return undefined
    })

    fn()
    fn()

    expect(calls).toBe(1)
    expect(fn.stats.hits).toBe(1)
  })

  it('supports multiple arguments', () => {
    let calls = 0

    const fn = memoize((a: number, b: number) => {
      calls++
      return a + b
    })

    expect(fn(1, 2)).toBe(3)
    expect(fn(1, 2)).toBe(3)
    expect(fn(2, 1)).toBe(3)

    expect(calls).toBe(2)
  })

  it('uses object identity for arguments', () => {
    let calls = 0

    const fn = memoize((_value: object) => {
      calls++
      return calls
    })

    const a = {}
    const b = {}

    expect(fn(a)).toBe(1)
    expect(fn(a)).toBe(1)
    expect(fn(b)).toBe(2)
  })

  it('supports a custom key resolver', () => {
    let calls = 0

    const fn = memoize(
      (value: { id: number; name: string }) => {
        calls++
        return value.name
      },
      {
        keyResolver: (value) => value.id
      }
    )

    expect(fn({ id: 1, name: 'Alice' })).toBe('Alice')
    expect(fn({ id: 1, name: 'Bob' })).toBe('Alice')

    expect(calls).toBe(1)
  })

  it('supports TTL expiration', () => {
    let now = 1000

    const fn = memoize((value: number) => value * 2, {
      ttlMs: 100,
      now: () => now
    })

    expect(fn(2)).toBe(4)

    now = 1100

    expect(fn(2)).toBe(4)
    expect(fn.stats.misses).toBe(2)
  })

  it('supports LRU eviction', () => {
    const fn = memoize((value: number) => value * 10, {
      maxSize: 2
    })

    fn(1)
    fn(2)
    fn(1)
    fn(3)

    expect(fn.has(1)).toBe(true)
    expect(fn.has(2)).toBe(false)
    expect(fn.has(3)).toBe(true)
    expect(fn.stats.evictions).toBe(1)
  })

  it('supports delete', () => {
    const fn = memoize((value: number) => value * 2)

    fn(2)

    expect(fn.delete(2)).toBe(true)
    expect(fn.delete(2)).toBe(false)
    expect(fn.has(2)).toBe(false)
  })

  it('supports clear', () => {
    const fn = memoize((value: number) => value * 2)

    fn(1)
    fn(2)
    fn.clear()

    expect(fn.stats.size).toBe(0)
    expect(fn.has(1)).toBe(false)
  })

  it('does not cache errors by default', () => {
    let calls = 0

    const fn = memoize(() => {
      calls++
      throw new Error('failure')
    })

    expect(() => fn()).toThrow('failure')
    expect(() => fn()).toThrow('failure')

    expect(calls).toBe(2)
  })

  it('supports caching thrown errors', () => {
    let calls = 0

    const fn = memoize(
      () => {
        calls++
        throw new Error('failure')
      },
      {
        cacheErrors: true
      }
    )

    expect(() => fn()).toThrow('failure')
    expect(() => fn()).toThrow('failure')

    expect(calls).toBe(1)
  })

  it('supports symbol arguments', () => {
    let calls = 0

    const fn = memoize((_value: symbol) => {
      calls++
      return calls
    })

    const a = Symbol('a')
    const b = Symbol('a')

    expect(fn(a)).toBe(1)
    expect(fn(a)).toBe(1)
    expect(fn(b)).toBe(2)
    expect(fn(Symbol.for('a'))).toBe(3)
    expect(fn(Symbol.for('a'))).toBe(3)
    expect(fn(Symbol.iterator)).toBe(4)
  })

  it('supports NaN and negative zero keys', () => {
    let calls = 0

    const fn = memoize((_value: number) => {
      calls++
      return calls
    })

    fn(NaN)
    fn(NaN)
    fn(-0)
    fn(0)

    expect(calls).toBe(3)
  })

  it('supports function context', () => {
    const fn = memoize(function (this: { value: number }) {
      return this.value
    })

    expect(fn.call({ value: 10 })).toBe(10)
  })

  it('validates maxSize', () => {
    expect(() => memoize((value: number) => value, { maxSize: 0 })).toThrow(RangeError)
  })

  it('validates TTL', () => {
    expect(() => memoize((value: number) => value, { ttlMs: -1 })).toThrow(RangeError)
  })
})

describe('memoizeAsync', () => {
  it('caches resolved values', async () => {
    let calls = 0

    const fn = memoizeAsync(async (value: number) => {
      calls++
      return value * 2
    })

    expect(await fn(2)).toBe(4)
    expect(await fn(2)).toBe(4)

    expect(calls).toBe(1)
  })

  it('deduplicates concurrent calls', async () => {
    let calls = 0

    const fn = memoizeAsync(async (value: number) => {
      calls++

      await Promise.resolve()

      return value * 2
    })

    const [a, b, c] = await Promise.all([fn(2), fn(2), fn(2)])

    expect(a).toBe(4)
    expect(b).toBe(4)
    expect(c).toBe(4)
    expect(calls).toBe(1)
  })

  it('tracks async cache hits and misses', async () => {
    const fn = memoizeAsync(async (value: number) => value)

    await fn(1)
    await fn(1)
    await fn(2)

    expect(fn.stats.hits).toBe(1)
    expect(fn.stats.misses).toBe(2)
  })

  it('does not cache rejected promises by default', async () => {
    let calls = 0

    const fn = memoizeAsync(async () => {
      calls++
      throw new Error('failure')
    })

    await expect(fn()).rejects.toThrow('failure')
    await expect(fn()).rejects.toThrow('failure')

    expect(calls).toBe(2)
  })

  it('preserves a replacement when an earlier shared call rejects', async () => {
    let rejectFirst!: (error: Error) => void
    let calls = 0
    const fn = memoizeAsync(() => {
      calls++
      if (calls !== 1) return Promise.resolve(42)

      return new Promise<number>((_, reject) => {
        rejectFirst = reject
      })
    })

    const first = fn()
    const shared = Array.from({ length: 128 }, () => fn())
    expect(shared.every((call) => call === first)).toBe(true)

    fn.delete()
    const replacement = fn()
    rejectFirst(new Error('earlier call failed'))

    await expect(first).rejects.toThrow('earlier call failed')
    expect(fn()).toBe(replacement)
    await expect(replacement).resolves.toBe(42)
    expect(calls).toBe(2)
  })

  it('supports caching rejected promises', async () => {
    let calls = 0

    const fn = memoizeAsync(
      async () => {
        calls++
        throw new Error('failure')
      },
      {
        cacheRejected: true
      }
    )

    await expect(fn()).rejects.toThrow('failure')
    await expect(fn()).rejects.toThrow('failure')

    expect(calls).toBe(1)
  })

  it('supports deleting async cache entries', async () => {
    let calls = 0

    const fn = memoizeAsync(async (value: number) => {
      calls++
      return value
    })

    await fn(1)

    fn.delete(1)

    await fn(1)

    expect(calls).toBe(2)
  })

  it('supports clearing async cache', async () => {
    const fn = memoizeAsync(async (value: number) => value)

    await fn(1)
    fn.clear()

    expect(fn.stats.size).toBe(0)
  })

  it('supports async TTL', async () => {
    let now = 1000
    let calls = 0

    const fn = memoizeAsync(
      async (value: number) => {
        calls++
        return value
      },
      {
        ttlMs: 100,
        now: () => now
      }
    )

    await fn(1)

    now = 1100

    await fn(1)

    expect(calls).toBe(2)
  })

  it('supports async LRU eviction', async () => {
    const fn = memoizeAsync(async (value: number) => value, {
      maxSize: 2
    })

    await fn(1)
    await fn(2)
    await fn(1)
    await fn(3)

    expect(fn.has(1)).toBe(true)
    expect(fn.has(2)).toBe(false)
    expect(fn.has(3)).toBe(true)
  })

  it('supports custom async key resolvers', async () => {
    let calls = 0

    const fn = memoizeAsync(
      async (value: { id: number }) => {
        calls++
        return value.id
      },
      {
        keyResolver: (value) => value.id
      }
    )

    await fn({ id: 1 })
    await fn({ id: 1 })

    expect(calls).toBe(1)
  })
})
