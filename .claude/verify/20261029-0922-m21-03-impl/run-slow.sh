#!/bin/sh
# tests/slow の迎撃の塔の describe だけを回す (worktree の根で)。終わると done-slow を置く
export PATH="$HOME/.nvm/versions/node/v24.22.1/bin:$PATH"
DIR=.claude/verify/20261029-0922-m21-03-impl
rm -f "$DIR/done-slow"
start=$(date +%s)
SLOW=1 caffeinate -s pnpm exec vitest run tests/slow/scenarios.playthrough.test.ts -t "^intercept-tower scenario playthroughs" --reporter=verbose > "$DIR/slow.log" 2>&1
echo "exit $? wall $(( $(date +%s) - start ))s" >> "$DIR/slow.log"
touch "$DIR/done-slow"
