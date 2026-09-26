-- 港の帳簿 (M19-08、設計書 docs/design/2026-09-26-cloudflare-architecture.md §3・§5.1・§6)。
-- 生の IP・自由文・取り下げ鍵そのものは置かない。

-- 年代記。id は正規化した年代記の SHA-256 (Worker が chronicleId で計算する)。同じ年代記の出港は INSERT OR IGNORE で 1 件になる
CREATE TABLE chronicles (
  id TEXT PRIMARY KEY,
  sim_version TEXT NOT NULL,
  scenario_id TEXT NOT NULL,
  seed INTEGER NOT NULL,
  inscription TEXT NOT NULL,
  verdict TEXT NOT NULL,
  year INTEGER NOT NULL,
  digest_hash TEXT NOT NULL,
  -- 正規化した年代記の JSON (16 KB まで)
  body TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  published_at INTEGER NOT NULL,
  -- 取り下げ鍵の SHA-256。鍵そのものは出港した手元にだけある
  withdraw_hash TEXT NOT NULL,
  confirms INTEGER NOT NULL DEFAULT 0,
  mismatches INTEGER NOT NULL DEFAULT 0,
  reports INTEGER NOT NULL DEFAULT 0,
  -- 隠した時刻 (epoch ms)。NULL なら見える。通報 3 件で自動で入り、運営が scripts/mod.py で戻す
  hidden_at INTEGER
) STRICT;

-- 一覧は見える年代記だけを新しい順に引く (部分索引。問い合わせにも hidden_at IS NULL をそのまま書く)
CREATE INDEX chronicles_visible ON chronicles (published_at DESC, id DESC) WHERE hidden_at IS NULL;
CREATE INDEX chronicles_visible_by_scenario ON chronicles (scenario_id, published_at DESC, id DESC) WHERE hidden_at IS NULL;

-- 通報。同じ送り手の同じ日の 2 度目は数えない。sender は日替わりの salt の HMAC で、Cron が翌日に消す
CREATE TABLE reports (
  chronicle_id TEXT NOT NULL REFERENCES chronicles (id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  sender TEXT NOT NULL,
  PRIMARY KEY (chronicle_id, day, sender)
) STRICT, WITHOUT ROWID;
CREATE INDEX reports_by_day ON reports (day);

-- 舟の積荷。漂着は rowid の乱数で 1 件引く (ORDER BY RANDOM() は全件を読むので使わない)
CREATE TABLE cargo (
  id TEXT NOT NULL UNIQUE,
  items TEXT NOT NULL,
  cast_at INTEGER NOT NULL
) STRICT;
CREATE INDEX cargo_by_cast_at ON cargo (cast_at);

-- 回避の集計。石板と判定ごとの件数。どの判定を「越えた」とみなすかは読む側 (Worker) が決める
CREATE TABLE outcomes (
  scenario_id TEXT NOT NULL,
  verdict TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (scenario_id, verdict)
) STRICT, WITHOUT ROWID;

-- 日次予算。day は UTC の日付 (YYYY-MM-DD)、bucket は道の種類 (worker/src/policy.ts の BUDGETS の鍵)
CREATE TABLE daily_budget (
  day TEXT NOT NULL,
  bucket TEXT NOT NULL,
  used INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, bucket)
) STRICT, WITHOUT ROWID;

-- Cron が毎日書く保存量の集計 (運営が scripts/mod.py で読む)
CREATE TABLE harbor_stats (
  day TEXT PRIMARY KEY,
  stored_bytes INTEGER NOT NULL,
  chronicles INTEGER NOT NULL,
  hidden INTEGER NOT NULL,
  cargo INTEGER NOT NULL,
  measured_at INTEGER NOT NULL
) STRICT;
