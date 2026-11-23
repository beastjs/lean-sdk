#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
repo_dir="$PWD"
check_dir="$(mktemp -d)"
trap 'rm -rf "$check_dir"' EXIT

bun run build
archive="$(npm pack --ignore-scripts --silent --pack-destination "$check_dir")"
archive_path="$check_dir/$archive"

tar -tzf "$archive_path" | while IFS= read -r entry; do
  case "$entry" in
    package/package.json|package/README.md|package/CHANGELOG.md|package/LICENSE*|\
    package/docs/lean-math-sdk-masterplan.md|package/src/core/usage.md|\
    package/dist/index.js|package/dist/index.d.ts|package/dist/src/*.js|package/dist/src/*.d.ts)
      ;;
    *)
      printf 'Unexpected file in package: %s\n' "$entry" >&2
      exit 1
      ;;
  esac
done

mkdir "$check_dir/consumer"
cd "$check_dir/consumer"
printf '{"private":true,"type":"module"}\n' > package.json
npm install --offline --ignore-scripts --no-package-lock --no-audit --no-fund "$archive_path"

cat > smoke.mts <<'EOF'
import { approximatelyEqual, degreesToRadians, SerialQueue } from 'lean-math-sdk'
import { memoize, SerialQueue as CoreQueue } from 'lean-math-sdk/core'
import { clamp, type ApproximateEqualityOptions } from 'lean-math-sdk/numeric'

const options: ApproximateEqualityOptions = { relativeTolerance: 1e-12 }
if (SerialQueue !== CoreQueue || clamp(4, 0, 3) !== 3 || !approximatelyEqual(degreesToRadians(180), Math.PI, options)) {
  throw new Error('Unexpected values from package exports')
}

const key = Symbol('smoke test')
const cached = memoize((value: symbol) => value)
if (cached(key) !== key || !cached.has(key)) throw new Error('Symbol memoization failed')
EOF

"$repo_dir/node_modules/.bin/tsc" --strict --module NodeNext --target ES2022 --noEmitOnError --outDir runtime smoke.mts
node runtime/smoke.mjs
bun runtime/smoke.mjs

printf "import { clamp } from 'lean-math-sdk'; if (clamp(4, 0, 3) !== 3) throw new Error('Bundled import failed');\n" > bundle.mjs
bun build bundle.mjs --target=node --outfile bundled.mjs
node bundled.mjs
if grep -qF 'Rate limiter has been disposed.' bundled.mjs; then
  printf 'Unused rate limiter code remained in the bundle.\n' >&2
  exit 1
fi

mkdir -p "$repo_dir/out"
cp "$archive_path" "$repo_dir/out/$archive"
printf 'Verified package: out/%s\n' "$archive"
