#!/usr/bin/env bash
# run-e2e.sh や手で起こしたものの pid (置き場の pids に 1 行 1 つ) だけを止める。証拠は残す
set -u
dir="${1:?証拠の置き場}"
[ -f "$dir/pids" ] || { echo "pids 無し (止めるものは無い)"; exit 0; }
while read -r pid; do [ -n "$pid" ] && kill "$pid" 2>/dev/null && echo "stopped $pid"; done < "$dir/pids"
: > "$dir/pids"
echo "証拠は残した: $dir"
