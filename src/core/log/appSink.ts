import { createConsoleSink } from './consoleSink';
import { createHttpSink, type HttpSinkOptions } from './httpSink';
import type { LogSink } from './types';

export type AppLogSink = { log: LogSink; flushViaBeacon(): void };

export function createAppLogSink(
  { url: rawUrl, out, ...httpOpts }: { url: string | undefined; out?: (line: string) => void } & HttpSinkOptions,
): AppLogSink {
  const console_ = createConsoleSink(out);
  const url = rawUrl?.trim();
  if (!url) return { log: console_, flushViaBeacon: () => {} };
  const http = createHttpSink(url, httpOpts);
  return {
    log: {
      write(record) {
        console_.write(record);
        http.write(record);
      },
    },
    flushViaBeacon: http.flushViaBeacon,
  };
}
