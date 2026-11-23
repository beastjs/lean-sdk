# Lean Math SDK

Lean Math SDK provides numeric helpers and TypeScript utilities for asynchronous work, cancellation, state, and caching. The first package candidate is `0.1.0`. It ships ESM and TypeScript declarations for Node.js 22.12 or newer and Bun 1.4 or newer.

## Install the local package

From a consumer project, install the tarball produced by `check:package`.

```bash
npm install /path/to/lean-math-sdk/out/lean-math-sdk-0.1.0.tgz
```

Use `lean-math-sdk` for the entire API, or import from the `lean-math-sdk/core` and `lean-math-sdk/numeric` subpaths.

```ts
import { SerialQueue } from 'lean-math-sdk/core'
import { clamp, degreesToRadians } from 'lean-math-sdk/numeric'

const queue = new SerialQueue()
const angle = await queue.enqueue(() => degreesToRadians(clamp(205, 0, 180)))
console.log(angle) // 3.141592653589793
queue.dispose()
```

The numeric APIs operate on JavaScript `number` values and require finite inputs. See the [numeric contract](docs/lean-math-sdk-masterplan.md#initial-numeric-contract) and [core API guide](src/core/usage.md) for behavior and examples.

## Develop and package

Use Bun to install development dependencies and run the checks. The package check also uses Node.js and npm.

```bash
bun install --frozen-lockfile
bun run typecheck
bun run test
bun run check:package
```

`bun run build` emits ESM and declarations under `dist/`. `bun run check:package` builds the SDK, checks the packed file list, installs the tarball into a fresh project, verifies imports and declarations, and checks that a bundle can drop unused code. It saves the verified archive under `out/`.

## Release policy

Record user-visible changes in the [changelog](CHANGELOG.md). During `0.x`, use patch releases for compatible fixes and minor releases for new APIs or documented breaking changes. Use the public entry points listed above for compatibility.

The candidate is marked private. Before registry publication, confirm the license and registry ownership or scope, update the package metadata, and run the local package check and GitHub CI against the final release commit. Report issues through the repository's issue tracker or the maintainer channel used to distribute the package.
