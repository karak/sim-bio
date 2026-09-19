#!/usr/bin/env bash
# 使い方: tools/issue-status.sh <id> <status> [evidence...]
# 例: tools/issue-status.sh M1-01 done "abc1234 tests/unit/sanity.test.ts"
set -euo pipefail
cd "$(dirname "$0")/.."
id="$1"; st="$2"; shift 2
f=$(ls issues/"$id"-*.md)
perl -pi -e "s/^status: .*/status: $st/" "$f"
if [[ $# -gt 0 ]]; then
  ev=$(printf '"%s", ' "$@"); ev="[${ev%, }]"
  perl -pi -e "s|^evidence: .*|evidence: $ev|" "$f"
fi
echo "$id -> $st"
