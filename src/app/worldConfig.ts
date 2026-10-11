import { resolveCivilizationStart } from '../simulation/civilization';
import type { SpeciesDef, WorldConfig } from '../simulation/types';
import type { ScenarioDef } from '../scenario/types';

/**
 * 舞台の島の設定 (M27-03)。world.default.json と種の表に、石板の start の上書きを重ねる。
 * 自由モード・訪問 (石板が null) は既定のまま。DOM も置き場も読まない
 */
export function scenarioConfigOf(base: Omit<WorldConfig, 'species'>, species: readonly SpeciesDef[], scenario: ScenarioDef | null): WorldConfig {
  const config: WorldConfig = { ...base, species: species.map((d) => ({ ...d, ...(scenario?.start?.species?.[d.id] ?? {}) })) };
  if (scenario?.start) {
    // 浅い写しなので、気候を書き換える前に写す (base の気候は書き換えない)
    config.climate = { ...config.climate };
    if (scenario.start.seed !== undefined) config.seed = scenario.start.seed;
    if (scenario.start.size !== undefined) config.size = scenario.start.size;
    if (scenario.start.tempOffset !== undefined) config.climate.tempOffset = scenario.start.tempOffset;
    if (scenario.start.rainScale !== undefined) config.climate.rainScale = scenario.start.rainScale;
    // 文明の初期段階・集落の上書き (M8-02)。home は他のコマンドと同じ規約で -1 なら島の中心
    config.civilization = resolveCivilizationStart(scenario.start.civilization, config.size);
    // 輝石の倍率 (M10-02): 脈を薄くする舞台装置
    if (scenario.start.crystalScale !== undefined) config.crystalScale = scenario.start.crystalScale;
    // 火山セルの上書き (M8-08)。他のセル指定と同じ規約で -1 なら島の中心。省略時は World の既定 (標高最大の陸セル) のまま
    if (scenario.start.volcanoCell !== undefined) {
      const { size } = config;
      config.volcanoCell = scenario.start.volcanoCell === -1 ? Math.floor(size / 2) * size + Math.floor(size / 2) : scenario.start.volcanoCell;
    }
  }
  return config;
}
