import { BufferAttribute, Color, DoubleSide, Mesh, PlaneGeometry } from 'three';
import { createToonMaterial } from './toon';
import type { TerrainField } from './terrain';

/**
 * 海と池 (設計 §5)。水深で浅瀬の色 → 深い青、岸では泡。波は頂点シェーダで実時間に揺らす。
 * 沈降で海岸線が動くので、地面の heightAt から水深を焼く (区域を作り直すときに一緒に作り直す)。
 */
const SHALLOW = new Color('#6FC7C0');
const DEEP = new Color('#2C6E8E');
const FOAM = new Color('#F4F7EF');

export type Water = {
  mesh: Mesh;
  update(t: number): void;
  /** 海面を level m 上げる (M22-08、沈降)。本体の沈降は全セルの標高を同じだけ下げるので、地面を作り直す代わりに海を上げる */
  setLevel(level: number): void;
};

export function createWater(field: TerrainField, extent: number): Water {
  // 区域の近くは細かく、遠くは地平まで伸ばすので分割を増やしすぎない (1 辺 240 分割)
  const segs = 240;
  const geo = new PlaneGeometry(extent, extent, segs, segs);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.getAttribute('position');
  const col = new Float32Array(pos.count * 3);
  const c = new Color();
  // 海面の高さ (沈降で上がる)。水深と泡の帯は海面から測り直す
  let level = 0;
  const paint = () => {
    for (let i = 0; i < pos.count; i++) {
      const depth = level - field.heightAt(pos.getX(i), pos.getZ(i));
      c.copy(SHALLOW).lerp(DEEP, Math.min(1, Math.max(0, depth / 6)));
      // 岸 (水深 0〜0.5 m) に泡の帯
      if (depth < 0.5 && depth > -0.2) c.lerp(FOAM, 0.55 * (1 - Math.abs(depth - 0.15) / 0.35));
      col[i * 3] = c.r;
      col[i * 3 + 1] = c.g;
      col[i * 3 + 2] = c.b;
    }
  };
  paint();
  geo.setAttribute('color', new BufferAttribute(col, 3));
  const mat = createToonMaterial({ vertexColors: true, transparent: true, opacity: 0.86, side: DoubleSide, rim: 0.25, rimColor: '#E8F6FF' });
  // 半透明の両面は裏と表の 2 回描かれる。水面は下から見ないので 1 回で描く (M22-03)
  mat.forceSinglePass = true;
  const uniforms = { uTime: { value: 0 } };
  const baseCompile = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    baseCompile.call(mat, shader, renderer);
    shader.uniforms.uTime = uniforms.uTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace(
        '#include <begin_vertex>',
        [
          '#include <begin_vertex>',
          'transformed.y += sin(position.x * 0.18 + uTime * 0.9) * 0.08 + sin(position.z * 0.23 - uTime * 0.7) * 0.06;',
        ].join('\n'),
      );
  };
  const mesh = new Mesh(geo, mat);
  mesh.position.y = 0.02;
  mesh.renderOrder = 1;
  mesh.name = 'observe-water';
  return {
    mesh,
    update: (t) => (uniforms.uTime.value = t),
    setLevel(l) {
      if (Math.abs(l - level) < 0.05) return;
      level = l;
      paint();
      geo.getAttribute('color').needsUpdate = true;
      mesh.position.y = 0.02 + level;
    },
  };
}
