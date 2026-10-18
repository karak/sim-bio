#!/usr/bin/env bash
# 空いたポートで Playwright を回し、証拠を .claude/verify/<日時>-<題>/ に書く
# 使い方: run-e2e.sh <題> [spec ...]
set -u
title="${1:?題}"; shift
root="$(git rev-parse --show-toplevel)"; cd "$root"
out="$root/.claude/verify/$(date +%Y%m%d-%H%M)-$title"
mkdir -p "$out"
port="${E2E_PORT:-}"
if [ -z "$port" ]; then
  port=5187; while lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; do port=$((port+1)); done
fi
{ echo "head $(git rev-parse HEAD)"; echo "branch $(git branch --show-current)"; echo "port $port"; echo "at $(date -u +%FT%TZ)"; echo "specs ${*:-all}"; } > "$out/meta.txt"
: > "$out/pids"
E2E_PORT="$port" PLAYWRIGHT_JSON_OUTPUT_NAME="$out/report.json" \
  pnpm exec playwright test "$@" --reporter=line,json --trace retain-on-failure --output "$out/test-results" 2>&1 | tee "$out/stdout.txt"
rc=${PIPESTATUS[0]}
echo "exit $rc" >> "$out/meta.txt"
echo "証拠: $out (exit $rc)"
exit $rc
