#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
go run github.com/gzuidhof/tygo generate --config tools/tygo.yaml
echo "generated web/lib/types.gen.ts"
