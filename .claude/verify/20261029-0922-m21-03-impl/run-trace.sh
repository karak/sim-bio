#!/bin/sh
# 本体計測を 8 行並列で回す。使い方: PROTO=1 sh run-trace.sh (worktree の根で)。終わると done-<tag> を置く
export PATH="$HOME/.nvm/versions/node/v24.22.1/bin:$PATH"
DIR=.claude/verify/20261029-0922-m21-03-impl
TAG=impl
[ "$PROTO" = "1" ] && TAG=proto
rm -f "$DIR/done-$TAG"
for n in idle answer-only ritual-only no-edict old-solution-stop9 stop-only solution-1 solution-2; do
  TRACE_ONLY=$n caffeinate -s pnpm exec vitest run -c "$DIR/vitest.config.ts" > "$DIR/log-$TAG-$n.txt" 2>&1 &
done
wait
cat "$DIR"/verdicts-$TAG-*.tsv | grep -v '^script' > "$DIR/verdicts-$TAG.tsv"
touch "$DIR/done-$TAG"
