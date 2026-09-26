import type { Command } from '../simulation/types';
import { YEARLY_POINTS, type Chronicle, type ChronicleHead, type TimedCommand, type YearlyTotals } from './contract';

/** UI が命令を流す先 (シナリオ中は ScenarioRunner.intervene)。ok が false なら拒否 (力が足りない・門で弾かれた・判定の後) */
export type DispatchLike<R extends { ok: boolean }> = { dispatch(cmd: Command): R; snapshot(): { tick: number } };

export type ChronicleRecorder<R extends { ok: boolean }> = {
  dispatch(cmd: Command): R;
  current(): Chronicle;
  /** 保存しておいた年代記の命令を引き継ぐ。頭 (版・石板・seed) が違う年代記は別の島なので投げる */
  resume(saved: Chronicle): void;
};

/** 年ごとの総数を 4 桁に丸め、YEARLY_POINTS 点を超えれば最初と最後の年を含めて等間隔に間引く */
export function yearlySeries(history: readonly Readonly<Record<string, number>>[]): YearlyTotals[] {
  const n = history.length;
  const picked = n <= YEARLY_POINTS ? history : Array.from({ length: YEARLY_POINTS }, (_, i) => history[Math.round((i * (n - 1)) / (YEARLY_POINTS - 1))]);
  return picked.map((row) => Object.fromEntries(Object.entries(row).map(([id, v]) => [id, Number(v.toPrecision(4))])));
}

/**
 * 年代記の記録 (設計書 §5.2)。World は変えず、UI の dispatch を外から包む。
 * 受理された命令だけを、受けたときの tick (次の stepOnce で適用される tick) と積む。予言の命令は runner が World へ直に流すので、ここを通らない。
 * yearly は年の境目ごとの評価の総数 (ScenarioRunner.totalsByYear)。境目ちょうどの値なので、再生でも同じ系列になる
 */
export function recordChronicle<R extends { ok: boolean }>(
  target: DispatchLike<R>,
  head: ChronicleHead,
  yearly: () => readonly Readonly<Record<string, number>>[],
): ChronicleRecorder<R> {
  const { simVersion, scenarioId, seed } = head;
  let commands: TimedCommand[] = [];
  return {
    dispatch(cmd) {
      const tick = target.snapshot().tick;
      const result = target.dispatch(cmd);
      if (result.ok) commands.push({ tick, command: structuredClone(cmd) });
      return result;
    },
    current: () => ({ simVersion, scenarioId, seed, commands: structuredClone(commands), yearly: yearlySeries(yearly()) }),
    resume(saved) {
      if (saved.simVersion !== simVersion || saved.scenarioId !== scenarioId || saved.seed !== seed) {
        throw new Error(`chronicle head differs: ${JSON.stringify({ simVersion: saved.simVersion, scenarioId: saved.scenarioId, seed: saved.seed })}`);
      }
      commands = saved.commands.map((c) => structuredClone(c));
    },
  };
}
