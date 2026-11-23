import { describe, expect, test } from 'vitest'
import { RateLimitAbortError, RateLimiter, RateLimiterDisposedError, createRateLimiter } from '../src/core/rate-limiter'

describe('RateLimiter', () => {
  test('starts with full capacity', () => {
    const limiter = new RateLimiter({
      capacity: 5,
      refillRate: 1
    })

    expect(limiter.availableTokens).toBe(5)

    limiter.dispose()
  })

  test('tryAcquire consumes tokens', () => {
    const limiter = createRateLimiter({
      capacity: 2,
      refillRate: 1,
      now: () => 0
    })

    expect(limiter.tryAcquire()).toBe(true)
    expect(limiter.tryAcquire()).toBe(true)
    expect(limiter.tryAcquire()).toBe(false)

    expect(limiter.availableTokens).toBe(0)

    limiter.dispose()
  })

  test('acquire resolves immediately when tokens are available', async () => {
    const limiter = new RateLimiter({
      capacity: 2,
      refillRate: 1,
      now: () => 0
    })

    await expect(limiter.acquire()).resolves.toBeUndefined()

    expect(limiter.availableTokens).toBe(1)

    limiter.dispose()
  })

  test('queues requests when bucket is empty', async () => {
    const limiter = new RateLimiter({
      capacity: 1,
      refillRate: 10
    })

    await limiter.acquire()

    const pending = limiter.acquire()

    expect(limiter.pending).toBe(1)

    await pending

    expect(limiter.pending).toBe(0)

    limiter.dispose()
  })

  test('refills tokens over time', async () => {
    const limiter = new RateLimiter({
      capacity: 1,
      refillRate: 20
    })

    await limiter.acquire()

    await new Promise((resolve) => setTimeout(resolve, 100))

    expect(limiter.availableTokens).toBeGreaterThanOrEqual(1)

    limiter.dispose()
  })

  test('does not exceed bucket capacity', async () => {
    const limiter = new RateLimiter({
      capacity: 2,
      refillRate: 100
    })

    await new Promise((resolve) => setTimeout(resolve, 100))

    expect(limiter.availableTokens).toBe(2)

    limiter.dispose()
  })

  test('preserves FIFO queue order', async () => {
    const limiter = new RateLimiter({
      capacity: 1,
      refillRate: 50
    })

    await limiter.acquire()

    const order: number[] = []

    const first = limiter.acquire().then(() => {
      order.push(1)
    })

    const second = limiter.acquire().then(() => {
      order.push(2)
    })

    const third = limiter.acquire().then(() => {
      order.push(3)
    })

    await Promise.all([first, second, third])

    expect(order).toEqual([1, 2, 3])

    limiter.dispose()
  })

  test('supports aborting queued requests', async () => {
    const limiter = new RateLimiter({
      capacity: 1,
      refillRate: 1
    })

    await limiter.acquire()

    const controller = new AbortController()

    const pending = limiter.acquire({
      signal: controller.signal
    })

    controller.abort()

    await expect(pending).rejects.toBeInstanceOf(RateLimitAbortError)

    expect(limiter.pending).toBe(0)

    limiter.dispose()
  })

  test('rejects already-aborted signals', async () => {
    const limiter = new RateLimiter({
      capacity: 1,
      refillRate: 1
    })

    const controller = new AbortController()

    controller.abort()

    await expect(
      limiter.acquire({
        signal: controller.signal
      })
    ).rejects.toBeInstanceOf(RateLimitAbortError)

    limiter.dispose()
  })

  test('disposal rejects queued requests', async () => {
    const limiter = new RateLimiter({
      capacity: 1,
      refillRate: 1
    })

    await limiter.acquire()

    const pending = limiter.acquire()

    limiter.dispose()

    await expect(pending).rejects.toBeInstanceOf(RateLimiterDisposedError)

    expect(limiter.disposed).toBe(true)
    expect(limiter.pending).toBe(0)
  })

  test('disposal is idempotent', () => {
    const limiter = new RateLimiter({
      capacity: 1,
      refillRate: 1
    })

    limiter.dispose()
    limiter.dispose()

    expect(limiter.disposed).toBe(true)
  })

  test('tryAcquire returns false after disposal', () => {
    const limiter = new RateLimiter({
      capacity: 1,
      refillRate: 1
    })

    limiter.dispose()

    expect(limiter.tryAcquire()).toBe(false)
  })

  test('reset restores tokens', () => {
    const limiter = new RateLimiter({
      capacity: 5,
      refillRate: 1
    })

    limiter.tryAcquire()
    limiter.tryAcquire()

    limiter.reset()

    expect(limiter.availableTokens).toBe(5)

    limiter.dispose()
  })

  test('reset accepts a custom token count', () => {
    let currentTime = 0

    const limiter = new RateLimiter({
      capacity: 10,
      refillRate: 1,
      now: () => currentTime
    })

    limiter.reset(3)

    expect(limiter.availableTokens).toBe(3)

    currentTime = 1000

    expect(limiter.availableTokens).toBe(4)

    limiter.dispose()
  })

  test('exposes statistics', () => {
    let currentTime = 0

    const limiter = new RateLimiter({
      capacity: 3,
      refillRate: 1,
      now: () => currentTime
    })

    limiter.tryAcquire()
    limiter.tryAcquire()

    const stats = limiter.getStats()

    expect(stats.capacity).toBe(3)
    expect(stats.refillRate).toBe(1)
    expect(stats.tokens).toBe(1)
    expect(stats.totalAcquired).toBe(2)
    expect(stats.totalRejected).toBe(0)
    expect(stats.disposed).toBe(false)

    limiter.dispose()
  })

  test('validates capacity', () => {
    expect(
      () =>
        new RateLimiter({
          capacity: 0,
          refillRate: 1
        })
    ).toThrow(RangeError)
  })

  test('validates refill rate', () => {
    expect(
      () =>
        new RateLimiter({
          capacity: 1,
          refillRate: 0
        })
    ).toThrow(RangeError)
  })

  test('validates initial token count', () => {
    expect(
      () =>
        new RateLimiter({
          capacity: 2,
          refillRate: 1,
          initialTokens: 3
        })
    ).toThrow(RangeError)
  })

  test('validates reset token count', () => {
    const limiter = new RateLimiter({
      capacity: 2,
      refillRate: 1
    })

    expect(() => limiter.reset(3)).toThrow(RangeError)

    limiter.dispose()
  })

  test('acquire after disposal rejects', async () => {
    const limiter = new RateLimiter({
      capacity: 1,
      refillRate: 1
    })

    limiter.dispose()

    await expect(limiter.acquire()).rejects.toBeInstanceOf(RateLimiterDisposedError)
  })
})
