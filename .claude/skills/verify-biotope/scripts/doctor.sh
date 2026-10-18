#!/usr/bin/env bash
# 読むだけの点検。1 つでも赤なら終了コード 1
set -u
port="${1:-${E2E_PORT:-5181}}"
red=0
say() { printf '%s %s\n' "$1" "$2"; }
root="$(git rev-parse --show-toplevel 2>/dev/null)" || { say NG "git の外"; exit 1; }
cd "$root"
say OK "worktree $root @ $(git rev-parse --short HEAD) ($(git branch --show-current))"
[ -z "$(git status --porcelain -- src tests worker scripts tools)" ] && say OK "src/tests/worker/scripts/tools に未コミット無し" || say "!!" "未コミットの変更あり (証拠の HEAD が曖昧になる)"
[ -e node_modules/.bin/playwright ] && say OK "node_modules あり" || { say NG "node_modules 無し (pnpm install --frozen-lockfile)"; red=1; }
[ -L node_modules ] && say "!!" "node_modules は symlink (本体のものが古いことがある)"
if ls ~/Library/Caches/ms-playwright/chromium-* >/dev/null 2>&1; then say OK "Playwright の Chromium あり"; else say NG "Chromium 無し (pnpm exec playwright install chromium)"; red=1; fi
owner="$(lsof -nP -iTCP:"$port" -sTCP:LISTEN 2>/dev/null | awk 'NR==2{print $1" pid "$2}')"
if [ -z "$owner" ]; then say OK "port $port は空き (Playwright が立てる)"; else
  cwd="$(lsof -a -p "${owner##* }" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p')"
  if [ "$cwd" = "$root" ]; then say OK "port $port はこの worktree の $owner"; else say NG "port $port は別の場所の $owner ($cwd)。E2E_PORT をずらす"; red=1; fi
fi
command -v uv >/dev/null && say OK "uv あり (scripts)" || { say NG "uv 無し"; red=1; }
if command -v claude >/dev/null; then say OK "claude あり (層 B)"; else say "!!" "claude 無し (層 B は回せない)"; fi
c="$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:5390/ || true)"; [ "$c" = 200 ] && say OK "審査台 5390" || say "!!" "審査台 5390 は $c (層 C に出すなら node server.mjs)"
c="$(curl -s -o /dev/null -w '%{http_code}' http://localhost:5392/ || true)"; [ "$c" = 200 ] && say OK "受入の画面 5392" || say "!!" "受入の画面 5392 は $c"
exit $red
