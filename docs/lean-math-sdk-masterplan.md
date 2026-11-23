# Lean Math SDK — Master Plan

**Plan version:** 1.0  
**Prepared:** 23 November 2026  
**Current implementation baseline:** TypeScript + Bun, core utilities in progress/completed  
**Planning status:** Proposed roadmap; mathematical scope decisions are called out explicitly below.

---

## 1. Product direction

Build a modular, dependable mathematics SDK with a small and predictable core, carefully defined numerical behavior, a consistent TypeScript API, and testable mathematical components.

The SDK should aim to be:

- **Composable:** users can import only the modules they need.
- **Predictable:** numerical behavior, errors, precision, and edge cases are documented.
- **Type-safe:** public APIs provide useful generic types without making normal usage cumbersome.
- **Testable:** deterministic clocks and random sources are injectable wherever time or randomness affects behavior.
- **Efficient:** algorithms avoid unnecessary allocations and provide benchmarks for performance-sensitive paths.
- **Portable:** runtime and module-format support are explicit rather than accidental.

The name “Lean Math SDK” does not by itself settle the exact mathematical scope. The plan therefore separates foundational capabilities from advanced/optional areas that should be confirmed before implementation.

## 2. Guiding engineering principles

1. **Define semantics before algorithms.** Specify accepted inputs, output types, precision expectations, domain errors, and edge behavior before implementing a mathematical family.
2. **Keep the core independent.** General-purpose lifecycle, caching, cancellation, and event utilities should not depend on mathematical modules.
3. **Prefer explicit behavior.** Avoid silent coercion, hidden global state, surprising mutation, and implicit random seeds.
4. **Make nondeterminism injectable.** Time, randomness, scheduling, and external services should be controllable in tests when they affect outcomes.
5. **Test boundaries, not only happy paths.** Include zero, negative values, infinities, `NaN`, overflow/underflow, empty inputs, singular matrices, and invalid domains where applicable.
6. **Measure before optimizing.** Establish representative benchmarks before introducing specialized fast paths.
7. **Keep modules independently consumable.** Use a clear public export structure and avoid circular dependencies.

## 3. Current baseline — completed core utilities

The following modules have been implemented and are the current foundation:

| Module | Path | Status |
|---|---|---|
| Serial queue | `src/core/queue.ts` | Implemented |
| Error hierarchy | `src/core/errors.ts` | Implemented |
| Lifecycle manager | `src/core/lifecycle.ts` | Implemented |
| Typed event emitter | `src/core/event-emitter.ts` | Implemented |
| Deferred promise | `src/core/deferred.ts` | Implemented |
| Timeout/deadline utilities | `src/core/timeout.ts` | Implemented |
| Disposable stacks | `src/core/disposable.ts` | Implemented |
| Abort utilities | `src/core/abort.ts` | Implemented |
| Observable primitives | `src/core/observable.ts` | Implemented |
| State store | `src/core/state.ts` | Implemented |
| Cache | `src/core/cache.ts` | Implemented |
| Sync/async memoization | `src/core/memoize.ts` | Implemented |
| Token-bucket rate limiter | `src/core/rate-limiter.ts` | Implemented |

The latest local validation passed 361 tests across 15 files, strict type checking, and the TypeScript build. The private `0.1.0` tarball installed in a fresh project. Bun and Node.js loaded the compiled ESM entry points, and the consumer resolved the generated declarations.

---

# 4. Roadmap

## Phase 0 — Project foundation and conventions

**Goal:** make the package structure and engineering rules explicit before the mathematical surface expands.

- [ ] Confirm package name, package metadata, license, and repository conventions.
- [x] Establish Node.js 22.12+ and Bun 1.4+ as the initial runtime targets.
- [x] Ship compiled ESM with root, `/core`, and `/numeric` exports.
- [x] Build ES2022 and TypeScript declarations from production sources.
- [ ] Define source, test, benchmark, and documentation folder conventions.
- [x] Define CI checks for type checking, tests, building, and the packed package.
- [ ] Document strict compiler settings and lint/format expectations.

**Exit criteria:** a clean checkout can install dependencies, typecheck, run tests, and build using documented commands.

## Phase 1 — Core runtime utilities

**Goal:** finish the reusable runtime layer before mathematical algorithms depend on it.

### Implemented

- [x] Serial queue
- [x] Typed error hierarchy
- [x] Lifecycle management
- [x] Event emitter
- [x] Deferred promise
- [x] Timeout and deadline utilities
- [x] Disposable stack helpers
- [x] Abort utilities
- [x] Observable primitives
- [x] State store
- [x] Cache
- [x] Memoization
- [x] Rate limiter

### Hardening checklist

- [x] Run strict type checking and the full test suite for the current core baseline.
- [x] Review public exports and verify imports through the repository entry point and core barrel.
- [x] Review option names, error types, disposal, and statistics. Keep the existing contracts and document the differences in the core API guide.
- [x] Review resource ownership, timer scheduling, and listener cleanup. Add regressions for late lifecycle results, cancellation races, disposal reentrancy, and long timers.
- [x] Document synchronous callback error isolation and route immediate state selector notifications through the existing listener error handler.
- [x] Add stress tests for high queue depth, many listeners, cache churn, and concurrent async memoization.
- [x] Add examples for cancellation, transactions, cache policy, and rate limiting in the [core API guide](../src/core/usage.md).

**Exit criteria:** core APIs have stable exports, documented contracts, deterministic tests, and no known cleanup leaks.

## Phase 2 — Numeric foundation

**Goal:** define the numeric model shared by every mathematical module.

### Initial numeric contract

- Use JavaScript `number` (IEEE 754 binary64) for general numerical utilities. The first math APIs accept `number` values without coercion. Exact decimal, arbitrary precision, and `bigint` APIs remain separate scope decisions.
- Require finite inputs unless the function explicitly handles `NaN` or infinities. Functions that promise exact integer arithmetic require safe integers and throw `RangeError` if the exact result is outside the safe-integer range.
- Use `ValidationError` with code `VALIDATION_ERROR` for invalid inputs and domain violations, including division by `+0` or `-0`. Include the offending parameter name in `details` when applicable. Ordinary arithmetic functions return a number. Iterative algorithms can expose convergence through a documented result object.
- Throw `RangeError` when a valid computation exceeds the finite output range. Use ordinary binary64 rounding for finite results, including subnormal values and underflow to signed zero. Document functions that deliberately return nonfinite results.
- For approximate equality, require finite comparands and finite, nonnegative `absoluteTolerance` and `relativeTolerance`. Default to `0` absolute and `1e-12` relative tolerance. Accept when `|a − b| ≤ max(absoluteTolerance, relativeTolerance × max(|a|, |b|))`, with an overflow-safe implementation. Exact finite equality, including signed zeros, succeeds. Callers working near zero can supply an absolute tolerance in the units of their values.
- Iterative methods should document their stopping criterion, tolerances, and iteration limit. Use scale-aware absolute and relative checks where appropriate and report when a limit is reached without convergence.

The SDK entry point exports `assertFiniteNumber`, `assertSafeInteger`, `assertNonNegativeTolerance`, `approximatelyEqual`, and `ApproximateEqualityOptions`. The validators narrow `unknown` to `number` and report the parameter name in `ValidationError.details.parameter`.

```ts
import { approximatelyEqual } from 'lean-math-sdk/numeric'

approximatelyEqual(0.1 + 0.2, 0.3) // true
approximatelyEqual(0, 1e-15, { absoluteTolerance: 1e-14 }) // true
```

### Implementation candidates

- [ ] Numeric type aliases and shared interfaces.
- [ ] Constants (`PI`, `E`, infinities, machine epsilon, and related values as appropriate).
- [x] Shared finite, safe-integer, and nonnegative tolerance validators.
- [x] Approximate equality with tests at the finite limits, near zero, and at different scales.
- [x] Clamp to a finite inclusive interval.
- [ ] Sign, absolute value, min/max, sum, and product.
- [ ] Stable summation helpers (for example, compensated summation) where useful.
- [ ] Range/iterator helpers for numeric sequences.
- [ ] Shared test vectors and numerical accuracy tolerances.

**Exit criteria:** all modules share a documented numeric contract and common validation behavior.

## Phase 3 — Scalar and elementary mathematics

**Goal:** provide dependable everyday mathematical operations.

- [ ] Powers, roots, exponentials, and logarithms.
- [ ] Rounding, truncation, floor, ceiling, and modulo/remainder semantics.
- [ ] Trigonometric and inverse trigonometric functions.
- [ ] Hyperbolic functions if in scope.
- [x] Degree and radian conversion.
- [ ] Angle normalization.
- [ ] Factorial, permutations, combinations, and related discrete helpers.
- [ ] GCD, LCM, primality checks, and integer utilities if in scope.
- [ ] Constants and unit helpers where useful.

`clamp(value, min, max)` requires finite inputs and ordered bounds. It returns an in-range value unchanged, including signed zero. A reversed interval raises `ValidationError`.

`degreesToRadians` and `radiansToDegrees` accept finite angles, preserve sign, and convert the full magnitude, including angles beyond a full turn. They use ordinary binary64 rounding. `radiansToDegrees` raises `RangeError` if the result overflows.

**Quality requirements:** domain tests, boundary tests, reference comparisons, and documented precision limitations.

**Exit criteria:** scalar APIs have consistent naming and verified edge-case behavior.

## Phase 4 — Linear algebra

**Goal:** build reusable vector and matrix operations for numerical applications.

### Core structures

- [ ] Vector abstraction or well-defined array/typed-array API.
- [ ] Matrix abstraction with documented row/column layout.
- [ ] Shape and dimension validation.
- [ ] Immutable-by-default operations or clearly documented mutation variants.

### Operations

- [ ] Vector addition, subtraction, scaling, dot product, and norms.
- [ ] Matrix addition, subtraction, scalar multiplication, and matrix multiplication.
- [ ] Transpose, trace, determinant, and inverse where valid.
- [ ] Identity, diagonal, and zero matrix constructors.
- [ ] Linear system solving.
- [ ] LU and QR decomposition; consider Cholesky and eigen/SVD capabilities according to scope.
- [ ] Sparse matrix support only if real use cases justify the additional complexity.

**Quality requirements:** dimension mismatch tests, singular/ill-conditioned cases, numerical stability tests, and benchmarks for common matrix sizes.

**Exit criteria:** vector/matrix APIs are stable, tested, and suitable as dependencies for later numerical modules.

## Phase 5 — Statistics and probability

**Goal:** provide statistical summaries and probability building blocks.

- [ ] Mean, median, mode, quantiles, percentiles, and variance.
- [ ] Population versus sample variance/standard deviation semantics.
- [ ] Covariance and correlation.
- [ ] Weighted statistics and streaming/online accumulators.
- [ ] Probability distributions selected for the intended use cases.
- [ ] PDF/PMF, CDF, and sampling APIs where applicable.
- [ ] Seedable random-number source abstraction.
- [ ] Sampling, shuffling, and common random utilities.
- [ ] Confidence intervals and selected hypothesis-testing utilities if in scope.

**Quality requirements:** known reference datasets, statistical property tests, seeded reproducibility, and clear distinction between descriptive statistics and inferential methods.

**Exit criteria:** core statistics are deterministic when seeded and clearly document assumptions.

## Phase 6 — Numerical analysis and calculus

**Goal:** support numerical solutions to common mathematical problems.

- [ ] Interpolation (linear first; polynomial/spline methods based on demand).
- [ ] Numerical differentiation.
- [ ] Numerical integration (trapezoidal and Simpson methods initially; adaptive methods later).
- [ ] Root finding (bisection, secant, Newton-Raphson, and safeguarded variants).
- [ ] Convergence criteria and iteration limits.
- [ ] Error estimates and convergence diagnostics.
- [ ] Approximation and curve fitting utilities where appropriate.

**Quality requirements:** convergence tests, failure-mode tests, reference functions, and explicit handling of non-convergence.

**Exit criteria:** numerical methods return useful results and diagnostics without hiding convergence failures.

## Phase 7 — Optimization

**Goal:** add optimization algorithms after scalar math, linear algebra, and differentiation are mature.

- [ ] Objective-function and constraint interfaces.
- [ ] Gradient and finite-difference support.
- [ ] Gradient descent and common variants.
- [ ] Newton and quasi-Newton methods where practical.
- [ ] Line search and convergence criteria.
- [ ] Bounds and simple constraint handling.
- [ ] Optimization result objects with status, iterations, and diagnostics.

**Exit criteria:** optimization algorithms are benchmarked and report non-convergence or invalid inputs explicitly.

## Phase 8 — Symbolic mathematics (scope decision required)

**Goal:** optionally support expression construction and symbolic manipulation.

- [ ] Decide whether symbolic algebra is part of the SDK's intended product scope.
- [ ] Define expression tree and operator model.
- [ ] Add parsing only if a textual expression language is required.
- [ ] Implement evaluation and variable substitution.
- [ ] Add simplification and canonicalization rules.
- [ ] Add symbolic differentiation and selected algebraic transformations.
- [ ] Define serialization and safe expression boundaries.

This phase is intentionally conditional. Symbolic algebra can substantially increase the SDK's size and complexity; it should not delay a useful numerical SDK unless it is a core product requirement.

## Phase 9 — Interoperability and data handling

**Goal:** make the SDK practical to integrate with application code and numerical data sources.

- [ ] Define conversion helpers for arrays and typed arrays.
- [ ] Define serialization rules for supported numeric structures.
- [ ] Add import/export helpers for common data shapes where needed.
- [ ] Decide whether worker-based or streaming computations are in scope.
- [ ] Establish copy-versus-view semantics for typed-array operations.
- [ ] Add validation for malformed external data.

**Exit criteria:** conversions are predictable, typed, and documented with explicit ownership/mutation behavior.

## Phase 10 — Performance, reliability, and compatibility

**Goal:** validate that the SDK is reliable and efficient for its declared use cases.

- [ ] Add benchmarks for hot paths and representative workloads.
- [ ] Add property-based and randomized tests for algorithms where useful.
- [ ] Add regression tests for numerical edge cases and previously fixed bugs.
- [ ] Test memory behavior for caches, queues, subscriptions, and long-running computations.
- [ ] Verify cancellation and disposal during long-running operations.
- [ ] Test supported runtimes and package entry points.
- [ ] Document performance characteristics and algorithmic complexity.

**Exit criteria:** performance claims are backed by repeatable benchmarks and supported environments pass the compatibility suite.

## Phase 11 — Documentation and release

**Goal:** prepare the SDK for external use and sustainable maintenance.

- [x] Document local package installation and a quick-start example.
- [ ] Publish API references for all public modules.
- [ ] Add examples for core utilities and each math domain.
- [ ] Document numeric precision and algorithm limitations.
- [x] Record the initial package scope in the changelog and document the `0.x` versioning policy.
- [x] Configure compiled package exports and declaration output.
- [x] Verify the packed file list, clean installation, runtime imports, declaration resolution, and removal of unused code in a consumer bundle.
- [x] Configure GitHub CI to run the local release checks and document where to report issues.
- [ ] Confirm the distribution license and registry scope or ownership. Run CI against the final release commit before publishing.

**Exit criteria:** a new user can install the package, discover its APIs, understand numeric limitations, and reproduce the documented examples.

---

## 5. Suggested repository layout

This is a proposed structure, not a claim about the repository's current layout. Preserve the existing conventions where they already work.

```text
src/
  core/
    abort.ts
    cache.ts
    deferred.ts
    disposable.ts
    errors.ts
    event-emitter.ts
    lifecycle.ts
    memoize.ts
    observable.ts
    queue.ts
    rate-limiter.ts
    state.ts
    timeout.ts
    index.ts
  numeric/
    constants.ts
    validation.ts
    comparison.ts
    scalar.ts
    index.ts
  algebra/
    vector.ts
    matrix.ts
    decomposition/
    solvers/
    index.ts
  statistics/
    descriptive.ts
    distributions/
    random.ts
    index.ts
  calculus/
    differentiation.ts
    integration.ts
    interpolation.ts
    root-finding.ts
    index.ts
  optimization/
    gradient.ts
    algorithms/
    index.ts
  symbolic/                 # optional; only after scope is confirmed
    expression.ts
    simplify.ts
    differentiate.ts
    index.ts
  index.ts

tests/
  core/
  numeric/
  algebra/
  statistics/
  calculus/
  optimization/
  symbolic/                 # optional

benchmarks/
docs/
```

## 6. Quality gates for every module

A module should not be considered complete until it has:

- [ ] A clearly defined public API and exported types.
- [ ] Input validation and documented error behavior.
- [ ] Unit tests for standard behavior and edge cases.
- [ ] Deterministic tests for time/randomness when relevant.
- [ ] Strict TypeScript compatibility with the project's compiler settings.
- [ ] No unused symbols or accidental `any` leakage in the public API.
- [ ] Correct cleanup for timers, listeners, and resources it owns.
- [ ] Minimal usage examples and API documentation.
- [ ] A benchmark when performance is a meaningful part of the module's value.

Recommended local validation commands, assuming these scripts exist in `package.json`:

```bash
bun run typecheck
bun run test
bun run build
```

## 7. Decisions to confirm before the math layer grows

These questions materially affect architecture. They are recorded here rather than silently assumed:

1. **Additional precision:** Do future use cases require exact decimal or arbitrary-precision APIs alongside the initial `number` API?
2. **Primary use case:** Is the main target general scientific/numerical computing, application math utilities, financial math, machine-learning support, or a blend?
3. **Symbolic math:** Is symbolic expression manipulation a first-release requirement or a later optional package?
4. **Runtime support:** Is Bun the development/test runtime only, or a supported runtime alongside Node.js and browsers?
5. **Mutation policy:** Should mathematical operations be immutable by default, with explicit in-place variants for performance?
6. **Dependency policy:** Should algorithms be implemented internally, or may selected well-maintained dependencies be used?

Until these are confirmed, the roadmap should be treated as a practical proposal rather than a frozen specification.

## 8. Recommended immediate sequence

The initial package contains the current core and numeric APIs. Resume math development after release preparation in this order.

1. Define the real domains for powers, roots, exponentials, and logarithms. Record the decisions for `0^0`, zero with a negative exponent, negative bases with noninteger exponents, negative radicands, invalid log bases, and signed zero before implementing the functions.
2. Implement the scalar functions using the shared finite-number validators. Test domain errors, overflow, underflow, and ordinary results against known values. Add angle normalization and document its output interval alongside its boundary tests.
3. Define vector and matrix data layouts, shape validation, and mutation rules before adding linear algebra operations.
4. Add statistics, probability, and numerical analysis based on confirmed use cases. Revisit optimization, symbolic math, and additional precision as separate scope decisions.

---

**Maintenance rule:** update this document whenever a phase changes status. Mark a task complete only after its implementation, tests, typecheck, and public API review are actually done. Do not infer completion from a draft or a suggested code snippet.
