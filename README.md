# Lean Math SDK

The SDK currently provides TypeScript utilities for asynchronous work, cancellation, state, and caching. In this repository, import the core APIs from `index.ts` or `src/core/index.ts`.

Use Bun to install dependencies and run the project checks.

```bash
bun install --frozen-lockfile
bun run typecheck
bun run test
bun run build
```

The local build emits ESM and TypeScript declarations under `dist/`. The package is private.

See the [core API guide](src/core/usage.md) for usage examples.
