import type { LogSink } from './types';

/** JSON を 1 行ずつ console に出す。chrome-devtools の list_console_messages で読める形。 */
export function createConsoleSink(out: (line: string) => void = (l) => console.log(l)): LogSink {
  return {
    write(record) {
      out(JSON.stringify(record));
    },
  };
}
