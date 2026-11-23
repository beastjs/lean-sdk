import { describe, expect, it } from 'vitest'
import { Cache, createCache } from '../src/core/cache'

describe('Cache', () => {
  it('stores and retrieves values', () => {
    const cache = new Cache<string, number>()

    cache.set('a', 1)

    expect(cache.get('a')).toBe(1)
    expect(cache.has('a')).toBe(true)
    expect(cache.size).toBe(1)
  })

  it('supports cached undefined values', () => {
    const cache = new Cache<string, undefined>()

    cache.set('a', undefined)

    expect(cache.has('a')).toBe(true)
    expect(cache.get('a')).toBeUndefined()
  })

  it('supports getOrSet', () => {
    const cache = new Cache<string, number>()
    let calls = 0

    const factory = () => {
      calls++
      return 42
    }

    expect(cache.getOrSet('answer', factory)).toBe(42)
    expect(cache.getOrSet('answer', factory)).toBe(42)
    expect(calls).toBe(1)
  })

  it('supports getOrSet with undefined', () => {
    const cache = new Cache<string, undefined>()
    let calls = 0

    const factory = () => {
      calls++
      return undefined
    }

    cache.getOrSet('a', factory)
    cache.getOrSet('a', factory)

    expect(calls).toBe(1)
  })

  it('supports deleting entries', () => {
    const cache = new Cache<string, number>()

    cache.set('a', 1)

    expect(cache.delete('a')).toBe(true)
    expect(cache.delete('a')).toBe(false)
    expect(cache.has('a')).toBe(false)
  })

  it('supports clearing entries', () => {
    const cache = new Cache<string, number>()

    cache.set('a', 1)
    cache.set('b', 2)
    cache.clear()

    expect(cache.size).toBe(0)
  })

  it('supports TTL expiration', () => {
    let now = 1000

    const cache = new Cache<string, number>({
      ttlMs: 100,
      now: () => now
    })

    cache.set('a', 1)

    expect(cache.get('a')).toBe(1)

    now = 1100

    expect(cache.get('a')).toBeUndefined()
    expect(cache.size).toBe(0)
  })

  it('supports per-entry TTL', () => {
    let now = 1000

    const cache = new Cache<string, number>({
      ttlMs: 500,
      now: () => now
    })

    cache.set('short', 1, { ttlMs: 50 })
    cache.set('long', 2, { ttlMs: 200 })

    now = 1050

    expect(cache.has('short')).toBe(false)
    expect(cache.has('long')).toBe(true)
  })

  it('supports infinite TTL', () => {
    let now = 1000

    const cache = new Cache<string, number>({
      ttlMs: Infinity,
      now: () => now
    })

    cache.set('a', 1)

    now = 999999

    expect(cache.get('a')).toBe(1)
  })

  it('supports remainingTTL', () => {
    let now = 1000

    const cache = new Cache<string, number>({
      ttlMs: 100,
      now: () => now
    })

    cache.set('a', 1)

    expect(cache.remainingTTL('a')).toBe(100)

    now = 1040

    expect(cache.remainingTTL('a')).toBe(60)
  })

  it('supports expiresAt', () => {
    const cache = new Cache<string, number>({
      ttlMs: 100,
      now: () => 1000
    })

    cache.set('a', 1)

    expect(cache.expiresAt('a')).toBe(1100)
    expect(cache.expiresAt('missing')).toBeUndefined()
  })

  it('supports pruning expired entries', () => {
    let now = 1000

    const cache = new Cache<string, number>({
      ttlMs: 100,
      now: () => now
    })

    cache.set('a', 1)
    cache.set('b', 2)

    now = 1100

    expect(cache.pruneExpired()).toBe(2)
    expect(cache.size).toBe(0)
  })

  it('evicts least recently used entries', () => {
    const cache = new Cache<string, number>({
      maxSize: 2
    })

    cache.set('a', 1)
    cache.set('b', 2)

    cache.get('a')

    cache.set('c', 3)

    expect(cache.has('a')).toBe(true)
    expect(cache.has('b')).toBe(false)
    expect(cache.has('c')).toBe(true)
  })

  it('updates LRU order when setting an existing key', () => {
    const cache = new Cache<string, number>({
      maxSize: 2
    })

    cache.set('a', 1)
    cache.set('b', 2)
    cache.set('a', 10)
    cache.set('c', 3)

    expect(cache.get('a')).toBe(10)
    expect(cache.has('b')).toBe(false)
  })

  it('calls eviction callbacks', () => {
    const evictions: string[] = []

    const cache = new Cache<string, number>({
      maxSize: 1,
      onEvict: ({ key, reason }) => {
        evictions.push(`${key}:${reason}`)
      }
    })

    cache.set('a', 1)
    cache.set('b', 2)

    expect(evictions).toEqual(['a:capacity'])
  })

  it('calls expiration callbacks', () => {
    let now = 1000
    const evictions: string[] = []

    const cache = new Cache<string, number>({
      ttlMs: 10,
      now: () => now,
      onEvict: ({ key, reason }) => {
        evictions.push(`${key}:${reason}`)
      }
    })

    cache.set('a', 1)

    now = 1010

    cache.get('a')

    expect(evictions).toEqual(['a:expired'])
  })

  it('isolates eviction callback errors', () => {
    const errors: unknown[] = []

    const cache = new Cache<string, number>({
      maxSize: 1,
      onEvict: () => {
        throw new Error('eviction failure')
      },
      onEvictionError: (error) => {
        errors.push(error)
      }
    })

    cache.set('a', 1)
    expect(() => cache.set('b', 2)).not.toThrow()

    expect(errors).toHaveLength(1)
  })

  it('supports keys, values, and entries', () => {
    const cache = new Cache<string, number>()

    cache.set('a', 1)
    cache.set('b', 2)

    expect([...cache.keys()]).toEqual(['a', 'b'])
    expect([...cache.values()]).toEqual([1, 2])
    expect([...cache.entries()]).toEqual([
      ['a', 1],
      ['b', 2]
    ])
  })

  it('supports iteration', () => {
    const cache = new Cache<string, number>()

    cache.set('a', 1)
    cache.set('b', 2)

    expect([...cache]).toEqual([
      ['a', 1],
      ['b', 2]
    ])
  })

  it('validates maxSize', () => {
    expect(() => new Cache({ maxSize: 0 })).toThrow(RangeError)
    expect(() => new Cache({ maxSize: -1 })).toThrow(RangeError)
    expect(() => new Cache({ maxSize: 1.5 })).toThrow(RangeError)
  })

  it('validates TTL', () => {
    expect(() => new Cache({ ttlMs: -1 })).toThrow(RangeError)
    expect(() => new Cache({ ttlMs: NaN })).toThrow(RangeError)
  })

  it('validates per-entry TTL', () => {
    const cache = new Cache<string, number>()

    expect(() => cache.set('a', 1, { ttlMs: -1 })).toThrow(RangeError)
  })

  it('supports disposal', () => {
    const cache = new Cache<string, number>()

    cache.set('a', 1)
    cache.dispose()

    expect(cache.disposed).toBe(true)
  })

  it('disposes idempotently', () => {
    const cache = new Cache<string, number>()

    cache.dispose()
    cache.dispose()

    expect(cache.disposed).toBe(true)
  })

  it('rejects operations after disposal', () => {
    const cache = new Cache<string, number>()

    cache.dispose()

    expect(() => cache.get('a')).toThrow('Cache has been disposed.')

    expect(() => cache.set('a', 1)).toThrow('Cache has been disposed.')
  })

  it('supports the factory', () => {
    const cache = createCache<string, number>({
      maxSize: 10
    })

    cache.set('a', 1)

    expect(cache.get('a')).toBe(1)
  })
})
