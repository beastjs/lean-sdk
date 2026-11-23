# Core API guide

Import these APIs from `lean-math-sdk/core`. They are also available from `lean-math-sdk`.

| API | What it does |
|---|---|
| `SerialQueue` | Runs tasks one at a time in submission order. Cancelling an active task rejects its caller and signals the task. The queue waits for the task to finish before starting the next one. |
| `LeanMathError`, `normalizeError` | Provide coded SDK errors and convert arbitrary thrown values to `Error` instances. Core utilities can also expose operation-specific errors. |
| `LifecycleManager` | Shares an initialization attempt, waits for readiness, and disposes resources. Readiness waits can use a signal or a timeout. |
| `EventEmitter` | Dispatches events with typed argument tuples. `on` and `once` return unsubscribe functions and accept a signal. |
| `Deferred` | Exposes a promise and methods to resolve or reject it from another callback. The first settlement request takes effect. |
| `withTimeout`, `delay`, `raceWithSignal`, `createDeadline` | Run a task with a time limit, wait with cancellation, race an existing promise against a signal, or share a time budget across tasks. |
| `DisposableStack`, `AsyncDisposableStack` | Register cleanup in acquisition order and run it in reverse. Multiple cleanup failures are aggregated. |
| `abortable`, `linkAbortSignals`, `createTimeoutSignal` | Coordinate cancellation. Aborting a linked controller removes its subscriptions to the source signals. Dispose a timeout signal to clear its timer early. |
| `Observable` | Publishes changes to a value and provides read-only views. Subscribers can use a signal or unsubscribe explicitly. |
| `StateStore` | Updates and selects state. A synchronous transaction commits its changes together or rolls them back when its callback throws. |
| `Cache` | Stores values with a time-to-live and evicts least-recently-used entries when capacity is reached. Expiry is checked during operations. |
| `memoize`, `memoizeAsync` | Cache results by arguments. Async callers with the same key share a cached promise. Use `cacheRejected` to retain rejected promises. |
| `RateLimiter` | Acquires whole tokens in queue order from a continuously refilled bucket. `availableTokens` can contain a fractional balance. |

Durations such as `timeoutMs` and `ttlMs` are in milliseconds. The rate limiter's `refillRate` is in tokens per second, and its finite `capacity` must be at least one. Cache, memoization, and rate limiting accept injectable clocks through `now`.

### Cancellation, disposal, and errors

| API | How outcomes are reported |
|---|---|
| Abort utilities | `raceWithAbort` and `abortable` reject with the signal's reason when provided. `createAbortError` preserves an existing `Error`. |
| Timeout utilities | Abort-aware waits reject with `AbortError`, and deadlines and timeouts use `TimeoutError`. `createTimeoutAbortError` is the public name for the timeout module's `createAbortError`. |
| `SerialQueue` | Aborting an individual submission rejects with `QueueTaskCancelledError`. Disposal rejects outstanding submissions with `QueueDisposedError` and signals the active task. |
| `LifecycleManager` | Readiness waits use `LifecycleWaitCancelledError` and `LifecycleWaitTimeoutError`. Disposal waits for an in-flight initializer to settle and passes any resource it returns to the disposer, including a late result after cancellation. |
| `RateLimiter` | An aborted acquisition rejects with `RateLimitAbortError`. Disposal rejects queued and subsequent acquisitions with `RateLimiterDisposedError`. Nonblocking `tryAcquire()` returns `false` after disposal. |
| `EventEmitter`, `Observable`, `StateStore`, `Cache` | A disposed emitter ignores subscriptions and emissions. A disposed observable or state store rejects mutations and new subscriptions with a synchronous error. A disposed cache throws on further cache operations. |

Disposal is idempotent. Disposal scopes run cleanup even when their body throws. Stack cleanup attempts every registered callback and throws `DisposableError` when multiple callbacks fail. A cleanup callback should wait only on resources it owns, since the stack's own disposal promise depends on that callback finishing.

Lifecycle subscribers, event listeners, observable and state listeners, and cache eviction callbacks isolate synchronous exceptions during dispatch. `onListenerError` and `onEvictionError` can report those exceptions. Callbacks that compute values, such as an updater, a transaction body, or a selector evaluated during subscription setup, propagate their errors to the caller. Async work belongs in a task API or needs its own rejection handling when started from a synchronous listener.

### Statistics

Memoized functions expose a read-only `.stats` snapshot with hits, misses, evictions, and current cache size. `RateLimiter.getStats()` reports the bucket balance, queued requests, successful acquisitions, and rejected requests counted during active use. An unavailable `tryAcquire()` and a call after disposal leave those counters alone.

## Cancellation and timeouts

Pass a signal to an operation that can cooperate with cancellation. A timeout aborts the signal passed to a `withTimeout` task factory. An existing promise keeps running until its own operation finishes.

```ts
import { delay, withTimeout } from 'lean-math-sdk/core'

const controller = new AbortController()
const waiting = withTimeout((signal) => delay(5_000, { signal }), 10_000, {
  signal: controller.signal
})

controller.abort()
await waiting.catch((error: Error) => console.log(error.name))
```

For a shared time budget across operations, create one deadline with `createDeadline(10_000)`. Pass `deadline.remaining()` as the timeout for each operation and call `deadline.throwIfExpired()` before starting the next one.

## State transactions

```ts
import { createState } from 'lean-math-sdk/core'

const state = createState({ available: 3, reserved: 0 })
state.transaction((store) => {
  store.patch(({ available }) => ({ available: available - 1 }))
  store.patch(({ reserved }) => ({ reserved: reserved + 1 }))
})
console.log(state.getState()) // { available: 2, reserved: 1 }
state.dispose()
```

## Cache policy and rate limiting

```ts
import { createCache, createRateLimiter } from 'lean-math-sdk/core'

const cache = createCache<string, number>({ maxSize: 128, ttlMs: 60_000 })
const limiter = createRateLimiter({ capacity: 4, refillRate: 2 })

try {
  await limiter.acquire()
  console.log(cache.getOrSet('answer', () => 42))
} finally {
  limiter.dispose()
  cache.dispose()
}
```
