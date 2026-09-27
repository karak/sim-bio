interface ImportMetaEnv {
  /** ログの受け口 (M19-02)。例: /api/v1/logs。空なら HTTP へは送らない */
  readonly VITE_LOG_URL?: string;
  /** 港の API の置き場 (M19-09)。例: / (同じ origin の /api/v1/*)。空なら常に閉港 (出港は outbox に預ける) */
  readonly VITE_HARBOR_URL?: string;
  /** Turnstile の site key (M19-09)。空なら常に通るテストの sitekey */
  readonly VITE_TURNSTILE_SITEKEY?: string;
  /** 開発用の手段 (M19-16、src/dev) を入れた受入のビルド。"1" のときだけ入る (pnpm run build:acceptance)。本番のビルドには無い */
  readonly VITE_DEVTOOLS?: string;
}
