export type MemoizeKey = unknown

export type MemoizeKeyResolver<Args extends unknown[]> = (...args: Args) => MemoizeKey

export interface MemoizeOptions<Args extends unknown[]> {
  maxSize?: number
  ttlMs?: number
  keyResolver?: MemoizeKeyResolver<Args>
  now?: () => number
  cacheErrors?: boolean
  cacheRejected?: boolean
}

export interface MemoizeStats {
  readonly hits: number
  readonly misses: number
  readonly evictions: number
  readonly size: number
}

interface MemoEntry<Value> {
  readonly value: Value
  readonly expiresAt: number | null
}

interface InternalOptions<Args extends unknown[]> {
  maxSize: number
  ttlMs: number
  keyResolver: MemoizeKeyResolver<Args>
  now: () => number
  cacheErrors: boolean
  cacheRejected: boolean
}

interface CacheLookup<Value> {
  readonly hit: boolean
  readonly value: Value | undefined
}

const objectIds = new WeakMap<object, number>()
const symbolIds = new Map<symbol, number>()

let nextIdentity = 1

function getIdentityKey(value: unknown): string {
  if ((typeof value === 'object' && value !== null) || typeof value === 'function') {
    const object = value as object
    let id = objectIds.get(object)

    if (id === undefined) {
      id = nextIdentity++
      objectIds.set(object, id)
    }

    return `object:${id}`
  }

  if (typeof value === 'symbol') {
    let id = symbolIds.get(value)

    if (id === undefined) {
      id = nextIdentity++
      symbolIds.set(value, id)
    }

    return `symbol:${id}`
  }

  if (typeof value === 'number') {
    if (Number.isNaN(value)) return 'number:NaN'
    if (Object.is(value, -0)) return 'number:-0'
    return `number:${value}`
  }

  if (typeof value === 'string') {
    return `string:${JSON.stringify(value)}`
  }

  return `${typeof value}:${String(value)}`
}

function defaultKeyResolver<Args extends unknown[]>(...args: Args): MemoizeKey {
  return JSON.stringify(args.map(getIdentityKey))
}

function normalizeOptions<Args extends unknown[]>(options: MemoizeOptions<Args> = {}): InternalOptions<Args> {
  const maxSize = options.maxSize ?? Infinity
  const ttlMs = options.ttlMs ?? Infinity

  if (maxSize !== Infinity && (!Number.isSafeInteger(maxSize) || maxSize < 1)) {
    throw new RangeError('maxSize must be a positive safe integer or Infinity.')
  }

  if (ttlMs !== Infinity && (!Number.isFinite(ttlMs) || ttlMs < 0)) {
    throw new RangeError('ttlMs must be a non-negative finite number or Infinity.')
  }

  return {
    maxSize,
    ttlMs,
    keyResolver: options.keyResolver ?? defaultKeyResolver,
    now: options.now ?? Date.now,
    cacheErrors: options.cacheErrors ?? false,
    cacheRejected: options.cacheRejected ?? false
  }
}

class MemoizedCache<Value> {
  private readonly entries = new Map<MemoizeKey, MemoEntry<Value>>()

  hits = 0
  misses = 0
  evictions = 0

  constructor(
    private readonly maxSize: number,
    private readonly ttlMs: number,
    private readonly now: () => number
  ) {}

  get size(): number {
    this.pruneExpired()
    return this.entries.size
  }

  lookup(key: MemoizeKey): CacheLookup<Value> {
    const entry = this.entries.get(key)

    if (!entry) {
      this.misses++
      return { hit: false, value: undefined }
    }

    if (this.isExpired(entry)) {
      this.entries.delete(key)
      this.evictions++
      this.misses++

      return { hit: false, value: undefined }
    }

    this.hits++

    // Move to most recently used.
    this.entries.delete(key)
    this.entries.set(key, entry)

    return { hit: true, value: entry.value }
  }

  peek(key: MemoizeKey): CacheLookup<Value> {
    const entry = this.entries.get(key)

    if (!entry) {
      return { hit: false, value: undefined }
    }

    if (this.isExpired(entry)) {
      this.entries.delete(key)
      this.evictions++

      return { hit: false, value: undefined }
    }

    return { hit: true, value: entry.value }
  }

  set(key: MemoizeKey, value: Value): void {
    const expiresAt = this.ttlMs === Infinity ? null : this.now() + this.ttlMs

    this.entries.delete(key)

    this.entries.set(key, {
      value,
      expiresAt
    })

    this.pruneExpired()
    this.evictOverflow()
  }

  delete(key: MemoizeKey): boolean {
    return this.entries.delete(key)
  }

  clear(): void {
    this.entries.clear()
  }

  keys(): IterableIterator<MemoizeKey> {
    this.pruneExpired()
    return this.entries.keys()
  }

  private isExpired(entry: MemoEntry<Value>): boolean {
    return entry.expiresAt !== null && entry.expiresAt <= this.now()
  }

  private pruneExpired(): void {
    for (const [key, entry] of this.entries) {
      if (this.isExpired(entry)) {
        this.entries.delete(key)
        this.evictions++
      }
    }
  }

  private evictOverflow(): void {
    while (this.entries.size > this.maxSize) {
      const oldest = this.entries.keys().next()

      if (oldest.done) break

      this.entries.delete(oldest.value)
      this.evictions++
    }
  }
}

export interface MemoizedFunction<Args extends unknown[], Result> {
  (...args: Args): Result
  delete(...args: Args): boolean
  clear(): void
  has(...args: Args): boolean
  readonly stats: MemoizeStats
  keys(): IterableIterator<MemoizeKey>
}

interface CachedError {
  readonly __memoizedError: true
  readonly error: unknown
}

function isCachedError(value: unknown): value is CachedError {
  return (
    typeof value === 'object' &&
    value !== null &&
    '__memoizedError' in value &&
    (value as CachedError).__memoizedError === true
  )
}

export function memoize<Args extends unknown[], Result>(
  fn: (...args: Args) => Result,
  options: MemoizeOptions<Args> = {}
): MemoizedFunction<Args, Result> {
  const normalized = normalizeOptions(options)

  const cache = new MemoizedCache<Result | CachedError>(normalized.maxSize, normalized.ttlMs, normalized.now)

  const memoized = function (this: unknown, ...args: Args): Result {
    const key = normalized.keyResolver(...args)
    const cached = cache.lookup(key)

    if (cached.hit) {
      if (isCachedError(cached.value)) {
        throw cached.value.error
      }

      return cached.value as Result
    }

    try {
      const result = fn.apply(this, args)

      cache.set(key, result)

      return result
    } catch (error) {
      if (normalized.cacheErrors) {
        cache.set(key, {
          __memoizedError: true,
          error
        })
      }

      throw error
    }
  } as MemoizedFunction<Args, Result>

  memoized.delete = (...args: Args) => cache.delete(normalized.keyResolver(...args))

  memoized.clear = () => cache.clear()

  memoized.has = (...args: Args) => cache.peek(normalized.keyResolver(...args)).hit

  memoized.keys = () => cache.keys()

  Object.defineProperty(memoized, 'stats', {
    enumerable: true,
    get: (): MemoizeStats => ({
      hits: cache.hits,
      misses: cache.misses,
      evictions: cache.evictions,
      size: cache.size
    })
  })

  return memoized
}

export interface MemoizedAsyncFunction<Args extends unknown[], Result> {
  (...args: Args): Promise<Result>
  delete(...args: Args): boolean
  clear(): void
  has(...args: Args): boolean
  readonly stats: MemoizeStats
  keys(): IterableIterator<MemoizeKey>
}

export function memoizeAsync<Args extends unknown[], Result>(
  fn: (...args: Args) => Promise<Result>,
  options: MemoizeOptions<Args> = {}
): MemoizedAsyncFunction<Args, Result> {
  const normalized = normalizeOptions(options)

  const cache = new MemoizedCache<Promise<Result>>(normalized.maxSize, normalized.ttlMs, normalized.now)

  const memoized = function (this: unknown, ...args: Args): Promise<Result> {
    const key = normalized.keyResolver(...args)
    const cached = cache.lookup(key)

    if (cached.hit) {
      return cached.value as Promise<Result>
    }

    let promise: Promise<Result>

    try {
      promise = Promise.resolve(fn.apply(this, args))
    } catch (error) {
      promise = Promise.reject(error)
    }

    cache.set(key, promise)

    if (!normalized.cacheRejected) {
      void promise.catch(() => {
        const current = cache.peek(key)

        // Only remove this call's promise, never a newer replacement.
        if (current.hit && current.value === promise) {
          cache.delete(key)
        }
      })
    }

    return promise
  } as MemoizedAsyncFunction<Args, Result>

  memoized.delete = (...args: Args) => cache.delete(normalized.keyResolver(...args))

  memoized.clear = () => cache.clear()

  memoized.has = (...args: Args) => cache.peek(normalized.keyResolver(...args)).hit

  memoized.keys = () => cache.keys()

  Object.defineProperty(memoized, 'stats', {
    enumerable: true,
    get: (): MemoizeStats => ({
      hits: cache.hits,
      misses: cache.misses,
      evictions: cache.evictions,
      size: cache.size
    })
  })

  return memoized
}
