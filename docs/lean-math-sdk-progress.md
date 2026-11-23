# Lean Math SDK — Progress Report

**As of:** 23 November 2026  
**Runtime/tooling discussed:** TypeScript + Bun  
**Current focus:** Numeric foundation

## 1. Current status

All 13 core modules are available through the repository entry point and the core barrel. The repository entry point also exports the numeric validators, approximate equality, clamp, and degree and radian conversion. Local validation passed **361 tests across 15 files**, strict TypeScript checking, and the build. The compiled ESM entry point loaded in Bun and Node.js, and the build emitted the entry-point declarations.

## 2. Completed core modules

The following modules have been implemented and discussed as part of the current development sequence.

| # | Module | Path | Main capabilities |
|---:|---|---|---|
| 1 | Serial queue | `src/core/queue.ts` | FIFO task execution, serialization, pending/running cancellation, abort support, and disposal. |
| 2 | Error system | `src/core/errors.ts` | Base `LeanMathError`, stable error codes, typed error hierarchy, and error normalization. |
| 3 | Lifecycle manager | `src/core/lifecycle.ts` | Lifecycle states, initialization, readiness, subscriptions, cancellation, and disposal. |
| 4 | Typed event emitter | `src/core/event-emitter.ts` | Typed events, `on`/`once`/`off`, unsubscribe callbacks, abort-aware listeners, snapshot dispatch, reentrancy handling, listener-error isolation, and cleanup. |
| 5 | Deferred promise | `src/core/deferred.ts` | Externally controlled promise settlement, settlement guards, state inspection, thenable adoption, and self-resolution protection. |
| 6 | Timeout utilities | `src/core/timeout.ts` | `TimeoutError`, abort errors, `delay`, `withTimeout`, `raceWithSignal`, and deadline helpers. |
| 7 | Disposable resources | `src/core/disposable.ts` | Synchronous and asynchronous disposable stacks, LIFO cleanup, idempotency, move/ownership transfer, cleanup error aggregation, and helper adapters. |
| 8 | Abort utilities | `src/core/abort.ts` | Abort listeners, linked/combined signals, timeout signals, abort races, abortable operations, abort promises, and child controllers. |
| 9 | Observable primitives | `src/core/observable.ts` | Typed observable values, subscriptions, equality checks, reentrancy-safe notification, readonly views, and derived map/filter observables. |
| 10 | State store | `src/core/state.ts` | State updates, patching, selectors, selective subscriptions, nested transactions/savepoints, rollback, readonly observable access, and disposal. |
| 11 | Cache | `src/core/cache.ts` | TTL, LRU eviction, capacity limits, per-entry expiry, cleanup, eviction callbacks, `getOrSet`, injected clock, and disposal. |
| 12 | Memoization | `src/core/memoize.ts` | Sync and async memoization, in-flight async request deduplication, TTL, LRU/max-size behavior, key resolution, optional error/rejection caching, and statistics. |
| 13 | Rate limiter | `src/core/rate-limiter.ts` | Token-bucket limiting, configurable capacity/refill rate, FIFO queued acquisitions, abortable waits, `tryAcquire`, reset, statistics, injected clock, and disposal. |

### Rate-limiter test adjustment

Two rate-limiter tests initially failed because they asserted exact token counts while the real clock continued advancing. The tests now use the limiter's injectable `now` clock. Fractional token replenishment is expected for a continuously refilled token bucket.

### Core hardening

- Readiness waits unsubscribe when they settle, lifecycle disposal releases subscribers, and calls from lifecycle subscribers share the active initialization or disposal promise.
- Observable disposal detaches abort listeners. Aborting a linked controller directly detaches its source subscriptions. Cancelling the final rate-limit waiter clears the refill timer.
- Regression and stress tests cover public imports, cleanup, FIFO cancellation under queue load, listener disposal, cache churn, and rejection of a shared memoized promise after replacement.
- The subsequent audit fixed late lifecycle resource disposal, queue cancellation precedence and listener cleanup, long timers, handling of rejected promises in pre-aborted races, selector callback errors, state transaction drafts, and cache reads near expiry. Memoization now tracks unique symbol identities weakly.
- The [core API guide](../src/core/usage.md) documents module contracts and includes runnable examples.

## 3. Validation record

| Checkpoint | Result |
|---|---|
| Deferred utilities | All tests passed; no issues reported. |
| Disposable utilities | Type issues were addressed; 8 test files passed. |
| Abort utilities | An already-aborted operation test was corrected; 9 test files passed. |
| Observable utilities | 10 test files passed. |
| State utilities | Strict optional-property/test typing issues were addressed; 11 test files passed. |
| Cache utilities | Strict optional-property typing issue was addressed; 12 test files passed. |
| Memoization | 13 test files passed after resolving unused generic/parameter warnings. |
| Rate limiter | Timing-sensitive tests were made deterministic. All 298 tests across 14 files and strict type checking passed. |
| Core hardening | All 309 tests across 14 files, strict type checking, the build, and Bun and Node.js import smoke checks passed. |
| Core API and cleanup review | All 322 tests across 14 files, strict type checking, the build, and Bun and Node.js import smoke checks passed. |
| Initial numeric APIs | All 343 tests across 15 files, strict type checking, the build, and Bun and Node.js import smoke checks passed. |
| Clamp and angle conversion | All 361 tests across 15 files, strict type checking, the build, and Bun and Node.js import smoke checks passed. |

## 4. TypeScript and implementation constraints captured so far

The project is being developed with strict TypeScript settings in mind, including:

- `strict`
- `exactOptionalPropertyTypes`
- `noUncheckedIndexedAccess`
- `noUnusedLocals`
- `noUnusedParameters`

Implementation choices already reinforced during development:

- Omit optional properties instead of assigning `undefined` when `exactOptionalPropertyTypes` requires it.
- Keep implementation types strict; use a narrow cast in tests only when intentionally testing invalid runtime inputs.
- Prefix intentionally unused callback parameters with `_` where appropriate.
- Use injected clocks for deterministic time-dependent tests.
- Use the runtime's actual `AbortSignal` behavior and test already-aborted signals explicitly.
- Do not treat a passing test run as proof of a separate typecheck/build unless that check was run and reported.

## 5. Remaining work

### Core phase checklist

- [x] Run strict type checking and the full test suite after the rate-limiter fixes and core hardening.
- [x] Review public imports and expose the modules through the core barrel and repository entry point.
- [x] Document core contracts and add usage examples.
- [x] Add regression coverage for timer cleanup, queue cancellation ordering, disposal during callbacks, and async memoization rejection behavior.
- [x] Review disposal, errors, options, and statistics and document current contracts in the core API guide.
- [x] Review resource ownership, cleanup, and callback behavior across the core APIs and test the fixes.

### Planned mathematical functionality

- [x] Choose JavaScript `number` for the initial numeric APIs and define input, tolerance, comparison, and error conventions in the [initial numeric contract](lean-math-sdk-masterplan.md#initial-numeric-contract).
- [x] Implement shared finite, safe-integer, and tolerance checks plus approximate equality. Tests cover signed zeros, subnormals, scale changes, opposite-sign overflow, and invalid inputs and tolerances.
- [x] Add clamp and degree and radian conversion. Tests cover reversed bounds, signed zero, underflow, and overflow.
- [ ] Add shared numeric constants where the math APIs need them.
- [ ] Implement scalar arithmetic and elementary functions.
- [ ] Implement vectors and matrices, followed by common linear algebra operations and solvers.
- [ ] Add probability and statistics utilities with injectable/seedable random sources where relevant.
- [ ] Add numerical analysis utilities such as interpolation, differentiation, integration, and root finding.
- [ ] Consider optimization and symbolic algebra as later modules, subject to the intended product scope.

### Release readiness

- [ ] Confirm supported runtimes and module formats.
- [ ] Verify package exports, declaration output, tree-shaking behavior, and build artifacts.
- [ ] Add CI for typecheck, tests, and build.
- [ ] Add API reference, usage examples, changelog, and release/versioning policy.

## 6. Suggested next development order

1. Add powers, roots, exponentials, and logarithms using the shared numeric primitives.
2. Build vectors, matrices, and linear algebra.
3. Add statistics, probability, and numerical analysis.
4. Decide whether optimization and symbolic math belong in the first major release.
5. Complete benchmarks, documentation, packaging, and CI before publishing.

