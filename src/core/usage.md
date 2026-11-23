# **USAGE**

- `TimeoutError` — consistent timeout errors.
- `AbortError` — consistent cancellation errors.
- `delay()` — abortable sleep.
- `withTimeout()` — timeout protection for promises and async tasks.
- `createDeadline()` — absolute deadline tracking.
- `raceWithSignal()` — race a promise against cancellation.
- Proper timer cleanup and protection against hanging resources.

For a worker request with a timeout:

```
const result = await withTimeout(
  (signal) => leanWorker.execute(code, { signal }),
  30_000,
  {
    message: 'Lean execution exceeded 30 seconds',
  },
)
```

For a shared time budget across multiple operations:

```
const deadline = createDeadline(10_000)

await initializeRuntime({
  timeout: deadline.remaining(),
})

deadline.throwIfExpired()

await loadModule({
  timeout: deadline.remaining(),
})

deadline.throwIfExpired()

await executeProof({
  timeout: deadline.remaining(),
})
```

For cancellable waiting:

```
const controller = new AbortController()

const waiting = delay(5000, {
  signal: controller.signal,
})

// Cancel whenever needed.
controller.abort()
```
