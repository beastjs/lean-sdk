export type CacheEvictionReason = 'expired' | 'capacity' | 'deleted' | 'cleared'

export interface CacheEviction<K, V> {
  readonly key: K
  readonly value: V
  readonly reason: CacheEvictionReason
}

export interface CacheSetOptions {
  /**
   * Time-to-live in milliseconds.
   * 0 means immediately expired.
   * Omitted uses the cache's default TTL.
   */
  ttlMs?: number
}

export interface CacheOptions<K, V> {
  /** Maximum number of entries. Defaults to Infinity. */
  maxSize?: number

  /** Default TTL in milliseconds. Defaults to Infinity. */
  ttlMs?: number

  /** Injectable clock for deterministic testing. */
  now?: () => number

  /** Called when entries are evicted. */
  onEvict?: (event: CacheEviction<K, V>) => void

  /** Called when onEvict throws. */
  onEvictionError?: (error: unknown) => void
}

interface CacheEntry<V> {
  readonly value: V
  readonly expiresAt: number | null
}

export class Cache<K, V> implements Iterable<[K, V]> {
  private readonly entriesMap = new Map<K, CacheEntry<V>>()

  private readonly maxSize: number
  private readonly defaultTTL: number
  private readonly clock: () => number

  private readonly onEvict: ((event: CacheEviction<K, V>) => void) | undefined

  private readonly onEvictionError: ((error: unknown) => void) | undefined
  constructor(options: CacheOptions<K, V> = {}) {
    this.maxSize = options.maxSize ?? Infinity
    this.defaultTTL = options.ttlMs ?? Infinity
    this.clock = options.now ?? Date.now

    this.onEvict = options.onEvict
    this.onEvictionError = options.onEvictionError

    this.validateMaxSize(this.maxSize)
    this.validateTTL(this.defaultTTL)
  }

  get size(): number {
    this.assertActive()
    this.pruneExpired()
    return this.entriesMap.size
  }

  private isDisposed = false

  get disposed(): boolean {
    return this.isDisposed
  }

  clear(): void {
    this.assertActive()
    this.clearEntries('cleared')
  }

  dispose(): void {
    if (this.isDisposed) return

    this.isDisposed = true
    this.clearEntries('cleared')
  }

  private clearEntries(reason: CacheEvictionReason): void {
    const snapshot = [...this.entriesMap.entries()]

    this.entriesMap.clear()

    for (const [key, entry] of snapshot) {
      this.notifyEviction(key, entry.value, reason)
    }
  }

  private assertActive(): void {
    if (this.isDisposed) {
      throw new Error('Cache has been disposed.')
    }
  }

  get(key: K): V | undefined {
    this.assertActive()

    const entry = this.entriesMap.get(key)

    if (!entry) return undefined

    if (this.isExpired(entry)) {
      this.evict(key, entry, 'expired')
      return undefined
    }

    // Refresh LRU position.
    this.touch(key, entry)

    return entry.value
  }

  has(key: K): boolean {
    this.assertActive()

    const entry = this.entriesMap.get(key)

    if (!entry) return false

    if (this.isExpired(entry)) {
      this.evict(key, entry, 'expired')
      return false
    }

    return true
  }

  set(key: K, value: V, options: CacheSetOptions = {}): this {
    this.assertActive()

    const ttl = options.ttlMs ?? this.defaultTTL
    this.validateTTL(ttl)

    const expiresAt = ttl === Infinity ? null : this.clock() + ttl

    const existing = this.entriesMap.get(key)

    if (existing) {
      this.entriesMap.delete(key)
    }

    this.entriesMap.set(key, {
      value,
      expiresAt
    })

    this.pruneExpired()

    this.evictOverflow()

    return this
  }

  delete(key: K): boolean {
    this.assertActive()

    const entry = this.entriesMap.get(key)

    if (!entry) return false

    this.evict(key, entry, 'deleted')

    return true
  }
  private touch(key: K, entry: CacheEntry<V>): void {
    this.entriesMap.delete(key)
    this.entriesMap.set(key, entry)
  }
  private isExpired(entry: CacheEntry<V>): boolean {
    return entry.expiresAt !== null && entry.expiresAt <= this.clock()
  }
  private evictOverflow(): void {
    while (this.entriesMap.size > this.maxSize) {
      const oldest = this.entriesMap.entries().next()

      if (oldest.done) break

      const [key, entry] = oldest.value

      this.evict(key, entry, 'capacity')
    }
  }
  /**
   * Removes all expired entries.
   *
   * @returns Number of removed entries.
   */
  pruneExpired(): number {
    this.assertActive()

    const now = this.clock()
    let removed = 0

    for (const [key, entry] of this.entriesMap) {
      if (entry.expiresAt !== null && entry.expiresAt <= now) {
        this.evict(key, entry, 'expired')
        removed++
      }
    }

    return removed
  }

  /**
   * Returns the cached value, or creates and stores it.
   *
   * Undefined values are supported and will still be cached.
   */
  getOrSet(key: K, factory: () => V, options?: CacheSetOptions): V {
    this.assertActive()

    if (this.has(key)) {
      return this.get(key) as V
    }

    const value = factory()

    this.set(key, value, options)

    return value
  }

  keys(): IterableIterator<K> {
    this.assertActive()
    this.pruneExpired()

    return this.entriesMap.keys()
  }

  values(): IterableIterator<V> {
    this.assertActive()
    this.pruneExpired()

    return this.mapValuesIterator()
  }

  entries(): IterableIterator<[K, V]> {
    this.assertActive()
    this.pruneExpired()

    return this.mapEntriesIterator()
  }

  /**
   * Returns the remaining TTL for a key.
   *
   * Infinity = no expiration.
   * 0 = expired or absent.
   */
  remainingTTL(key: K): number {
    this.assertActive()

    const entry = this.entriesMap.get(key)

    if (!entry) return 0

    if (entry.expiresAt === null) return Infinity

    const remaining = entry.expiresAt - this.clock()

    if (remaining <= 0) {
      this.evict(key, entry, 'expired')
      return 0
    }

    return remaining
  }

  /**
   * Returns the expiration timestamp.
   * null means the entry does not expire.
   * undefined means the key does not exist.
   */
  expiresAt(key: K): number | null | undefined {
    this.assertActive()

    const entry = this.entriesMap.get(key)

    if (!entry) return undefined

    if (this.isExpired(entry)) {
      this.evict(key, entry, 'expired')
      return undefined
    }

    return entry.expiresAt
  }

  /**
   * Iterates from least recently used to most recently used.
   */
  [Symbol.iterator](): IterableIterator<[K, V]> {
    return this.entries()
  }

  private evict(key: K, entry: CacheEntry<V>, reason: CacheEvictionReason): void {
    // Protect against stale entries and reentrant mutations.
    if (this.entriesMap.get(key) !== entry) return

    this.entriesMap.delete(key)

    this.notifyEviction(key, entry.value, reason)
  }

  private notifyEviction(key: K, value: V, reason: CacheEvictionReason): void {
    if (!this.onEvict) return

    try {
      this.onEvict({ key, value, reason })
    } catch (error) {
      try {
        this.onEvictionError?.(error)
      } catch {
        // Eviction callbacks must never break cache operations.
      }
    }
  }

  private *mapValuesIterator(): IterableIterator<V> {
    for (const entry of this.entriesMap.values()) {
      yield entry.value
    }
  }

  private *mapEntriesIterator(): IterableIterator<[K, V]> {
    for (const [key, entry] of this.entriesMap) {
      yield [key, entry.value]
    }
  }

  private validateTTL(ttl: number): void {
    if (ttl !== Infinity && (!Number.isFinite(ttl) || ttl < 0)) {
      throw new RangeError('ttlMs must be a non-negative finite number or Infinity.')
    }
  }

  private validateMaxSize(maxSize: number): void {
    if (maxSize !== Infinity && (!Number.isSafeInteger(maxSize) || maxSize < 1)) {
      throw new RangeError('maxSize must be a positive safe integer or Infinity.')
    }
  }
}

export function createCache<K, V>(options?: CacheOptions<K, V>): Cache<K, V> {
  return new Cache<K, V>(options)
}
