# docs/operations/ — 運用の文書

運用の手順 (配備・secret・本番への操作・撮り直しなど、人が決まった順で行う作業) は、このフォルダに書く。
リポジトリの README.md には置かない。README は入口で、ここへのリンクだけを持つ。
設計の判断は docs/design/ に書く。票の受入の基準も、運用の手順の置き場に README を指定せず、このフォルダの文書を指す。

この決まりは `scripts/check_readme.py` (`pnpm run check:readme`、`pnpm run check` に含む) が守る。
README に許可表 (`ALLOWED_HEADINGS`) にない見出し、運用の手順の印 (`wrangler deploy`・`gh secret`・`scripts/mod.py` など)、
200 行を超える長さがあると落ちる。docs/operations/ へのリンクを含む行は許す。

| 文書 | 内容 |
|---|---|
| [cloudflare.md](cloudflare.md) | Cloudflare への配備・手元での確かめ方・課金にしない決まり・運用 |
| [deploy-runbook.md](deploy-runbook.md) | 配備の手順書(端末の状態に左右されない形) |
| [cloudflare-deploy.md](cloudflare-deploy.md) | 配備の手順(人の作業と AI の作業) |
| [cloudflare-api-token.md](cloudflare-api-token.md) | CI 用の API トークンのテンプレート |
| [acceptance.md](acceptance.md) | 受入の確かめの手順 |
| [readme-screenshots.md](readme-screenshots.md) | README のスクリーンショットの撮り直し |
