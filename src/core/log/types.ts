export type LogLevel = 'info' | 'warn' | 'error';

/** 1 行 1 レコードの固定スキーマ。event はドット区切りの名前空間 (sim.tick.summary など)。 */
export type LogRecord = {
  ts: string;
  tick: number;
  year: number;
  level: LogLevel;
  event: string;
} & Record<string, unknown>;

/** ログの出口。console / memory / (将来) HTTP を差し替える継ぎ目。 */
export interface LogSink {
  write(record: LogRecord): void;
}
