import { createConsoleSink } from './consoleSink';
import { createHttpSink, type HttpSinkOptions } from './httpSink';
import type { LogSink } from './types';

export type AppLogSink = { log: LogSink; flushViaBeacon(): void };

export function createAppLogSink(
  deps: { url: string | undefined; out?: (line: string) => void } & Pick<HttpSinkOptions, 'fetch' | 'sendBeacon'>,
): AppLogSink {
  const console_ = createConsoleSink(deps.out);
  const url = deps.url?.trim();
  if (!url) return { log: console_, flushViaBeacon: () => {} };
  const http = createHttpSink(url, { fetch: deps.fetch, sendBeacon: deps.sendBeacon });
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
