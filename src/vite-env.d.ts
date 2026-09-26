interface ImportMetaEnv {
  /** ログの受け口 (M19-02)。例: /api/v1/logs。空なら HTTP へは送らない */
  readonly VITE_LOG_URL?: string;
}
