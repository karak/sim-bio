#!/usr/bin/env bash
# README に載せる縮小画を作る。docs/design/screenshots/*.png(元画、1600×900)は変えず、
# 横 640 の JPEG を docs/design/screenshots/small/ に書く。macOS の sips を使う。
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
src="$root/docs/design/screenshots"
out="$src/small"
quality="${QUALITY:-60}"

mkdir -p "$out"
for f in "$src"/*.png; do
  name="$(basename "$f" .png)"
  sips --resampleWidth 640 -s format jpeg -s formatOptions "$quality" "$f" --out "$out/$name.jpg" >/dev/null
  echo "$out/$name.jpg"
done
