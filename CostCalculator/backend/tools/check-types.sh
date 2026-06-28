#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
./tools/gen-types.sh
if ! git diff --quiet -- ../web/lib/types.gen.ts; then
  echo "ERROR: web/lib/types.gen.ts is out of date. Run backend/tools/gen-types.sh and commit." >&2
  git --no-pager diff -- ../web/lib/types.gen.ts
  exit 1
fi
echo "types.gen.ts is up to date"
