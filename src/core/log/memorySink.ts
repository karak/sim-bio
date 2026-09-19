import type { LogRecord, LogSink } from './types';

export type MemorySink = LogSink & {
  records: LogRecord[];
  clear(): void;
  find(event: string): LogRecord[];
};

/** テスト用。レコードを配列に溜める。 */
export function createMemorySink(): MemorySink {
  const records: LogRecord[] = [];
  return {
    records,
    write(r) {
      records.push(r);
    },
    clear() {
      records.length = 0;
    },
    find(event) {
      return records.filter((r) => r.event === event);
    },
  };
}
