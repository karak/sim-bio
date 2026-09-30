#!/bin/sh
# usage: judge.sh <image> <out.json>
D=$(cd "$(dirname "$0")" && pwd)
claude -p "$(cat "$D/rubric.md")

画像ファイル: $1" --output-format json --json-schema "$(cat "$D/schema.json")" --model opus \
  --system-prompt "受入の画を採点表で採点する。道具は Read だけ使う。" \
  --tools Read --allowedTools Read --add-dir "$D" --max-turns 4 --no-session-persistence \
  --disable-slash-commands --strict-mcp-config --setting-sources "" < /dev/null > "$2" 2> "$2.err"
