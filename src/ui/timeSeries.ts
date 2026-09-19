/** 年 1 点の時系列リングバッファ。容量到達で最古を捨てる。 */
export class TimeSeries {
  private xs: number[] = [];
  private data = new Map<string, number[]>();

  constructor(private readonly capacity: number) {}

  push(x: number, values: Record<string, number>): void {
    this.xs.push(x);
    for (const k of Object.keys(values)) {
      if (!this.data.has(k)) this.data.set(k, new Array<number>(this.xs.length - 1).fill(NaN));
    }
    for (const [k, arr] of this.data) arr.push(values[k] ?? NaN);
    if (this.xs.length > this.capacity) {
      this.xs.shift();
      for (const arr of this.data.values()) arr.shift();
    }
  }

  clear(): void {
    this.xs = [];
    this.data.clear();
  }

  get length(): number {
    return this.xs.length;
  }

  keys(): string[] {
    return [...this.data.keys()];
  }

  series(key: string): { x: number; y: number }[] {
    const arr = this.data.get(key);
    if (!arr) return [];
    return this.xs.map((x, i) => ({ x, y: arr[i] }));
  }

  latest(key: string): number | undefined {
    const arr = this.data.get(key);
    return arr && arr.length ? arr[arr.length - 1] : undefined;
  }

  xRange(): [number, number] {
    return this.xs.length ? [this.xs[0], this.xs[this.xs.length - 1]] : [0, 0];
  }
}
