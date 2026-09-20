#!/usr/bin/env bash
# issues/*.md の frontmatter から id / status / title を抜き出して一覧表示する。
# 使い方: tools/issues.sh [status]
set -euo pipefail
cd "$(dirname "$0")/.."
filter="${1:-}"
printf '%-8s %-12s %s\n' ID STATUS TITLE
for f in issues/[A-Z]*-[0-9]*-*.md; do
  id=$(sed -n 's/^id: *//p' "$f" | head -1)
  st=$(sed -n 's/^status: *//p' "$f" | head -1 | sed 's/ *#.*//')
  ti=$(sed -n 's/^title: *//p' "$f" | head -1)
  if [[ -z "$filter" || "$st" == "$filter" ]]; then printf '%-8s %-12s %s\n' "$id" "$st" "$ti"; fi
done
