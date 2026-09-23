import { BufferAttribute, BufferGeometry, Color, InstancedMesh, Matrix4, Quaternion, Vector3, type BufferGeometry as Geo } from 'three';
import { mulberry32 } from '../../simulation/rng';
import { createToonMaterial } from './toon';
import type { TerrainField } from './terrain';

/**
 * 草の房の GPU インスタンス (設計 §5)。密度 (本体の grass・moss) に比例して散らし、風で揺らす。
 * 房の形は assets/models/observe/flora.glb の grass_tuft があればそれ、無ければ 3 枚の葉の仮の形。
 */
export type Grass = { mesh: InstancedMesh; update(t: number, camera?: { x: number; z: number }): void };

/**
 * 距離で間引く (M22-03 の三角形の予算)。房は 1 つ 40 三角形あり、25,000 房を全部描くと 100 万になる。
 * カメラから NEAR_M までは全部、FAR_M までに KEEP_FAR まで、OUT_M までに KEEP_OUT まで減らす。どの房を残すかは房ごとの固定の乱数で決め、カメラが動いても同じ房が残る。
 */
const NEAR_M = 28;
const FAR_M = 70;
const KEEP_FAR = 0.3;
const KEEP_OUT = 0.2;
const OUT_M = 110;
export function grassKeep(d: number): number {
  if (d <= NEAR_M) return 1;
  if (d <= FAR_M) return 1 + ((KEEP_FAR - 1) * (d - NEAR_M)) / (FAR_M - NEAR_M);
  if (d <= OUT_M) return KEEP_FAR + ((KEEP_OUT - KEEP_FAR) * (d - FAR_M)) / (OUT_M - FAR_M);
  return KEEP_OUT;
}

function placeholderTuft(): Geo {
  const blades = 5;
  const pos: number[] = [];
  for (let b = 0; b < blades; b++) {
    const a = (b / blades) * Math.PI * 2;
    const lean = 0.12;
    const w = 0.05;
    const h = 0.45 + (b % 2) * 0.15;
    const dx = Math.cos(a);
    const dz = Math.sin(a);
    pos.push(-dz * w, 0, dx * w, dz * w, 0, -dx * w, dx * lean, h, dz * lean);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.computeVertexNormals();
  return g;
}

export function createGrass(field: TerrainField, layers: { grass?: Float32Array; moss?: Float32Array }, max: number, seed: number, tuft?: Geo, radiusM?: number): Grass {
  const geo = tuft ?? placeholderTuft();
  const mat = createToonMaterial({ color: '#FFFFFF', rim: 0.2, side: 2 });
  const uniforms = { uTime: { value: 0 } };
  const baseCompile = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    baseCompile.call(mat, shader, renderer);
    shader.uniforms.uTime = uniforms.uTime;
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;').replace(
      '#include <begin_vertex>',
      [
        '#include <begin_vertex>',
        // 房の上ほど揺れる。位置ごとに位相をずらし、風の帯が野を渡るように見せる
        'vec4 wp = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);',
        'float sway = sin(uTime * 1.6 + wp.x * 0.15 + wp.z * 0.07) * 0.5 + sin(uTime * 2.7 + wp.z * 0.3) * 0.2;',
        'transformed.x += sway * 0.12 * position.y;',
        'transformed.z += sway * 0.05 * position.y;',
      ].join('\n'),
    );
  };
  const mesh = new InstancedMesh(geo, mat, max);
  const rng = mulberry32(seed);
  // 草は区域 (半径 radiusM) の中に密に置く。縁の外は地面の色だけで遠景に溶かす
  const half = radiusM ?? field.window * 10;
  const m = new Matrix4();
  const q = new Quaternion();
  const p = new Vector3();
  const sc = new Vector3();
  const colA = new Color('#9CC35E');
  const colB = new Color('#C8C66E');
  const colM = new Color('#6FA64E');
  const c = new Color();
  let k = 0;
  for (let tries = 0; tries < max * 6 && k < max; tries++) {
    const x = (rng() * 2 - 1) * half;
    const z = (rng() * 2 - 1) * half;
    const h = field.heightAt(x, z);
    if (h < 1.0 || Math.hypot(x, z) > half) continue;
    const g = layers.grass ? field.layerAt(layers.grass, x, z) : 0.3;
    const mo = layers.moss ? field.layerAt(layers.moss, x, z) : 0;
    const want = Math.min(1, g * 2.2 + mo * 0.35 + 0.08);
    if (rng() > want) continue;
    p.set(x, h - 0.02, z);
    q.setFromAxisAngle(new Vector3(0, 1, 0), rng() * Math.PI * 2);
    const s = 1.4 + rng() * 1.2;
    sc.set(s, s * (0.8 + g), s);
    m.compose(p, q, sc);
    mesh.setMatrixAt(k, m);
    c.copy(colA).lerp(colB, rng() * 0.5).lerp(colM, Math.min(0.6, mo * 0.5));
    mesh.setColorAt(k, c);
    k++;
  }
  mesh.count = k;
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.name = 'observe-grass';
  // 全部の房の行列と色を控えておき、カメラが動いたら残す房だけを前に詰め直す
  const allM = mesh.instanceMatrix.array.slice(0, k * 16);
  const allC = mesh.instanceColor ? mesh.instanceColor.array.slice(0, k * 3) : null;
  const keepHash = Float32Array.from({ length: k }, () => rng());
  let lastX = Infinity;
  let lastZ = Infinity;
  const repack = (cx: number, cz: number) => {
    const im = mesh.instanceMatrix.array as Float32Array;
    const ic = mesh.instanceColor?.array as Float32Array | undefined;
    let n = 0;
    for (let i = 0; i < k; i++) {
      const d = Math.hypot(allM[i * 16 + 12] - cx, allM[i * 16 + 14] - cz);
      if (keepHash[i] > grassKeep(d)) continue;
      im.set(allM.subarray(i * 16, i * 16 + 16), n * 16);
      if (ic && allC) ic.set(allC.subarray(i * 3, i * 3 + 3), n * 3);
      n++;
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  };
  return {
    mesh,
    update(t, camera) {
      uniforms.uTime.value = t;
      if (camera && Math.hypot(camera.x - lastX, camera.z - lastZ) > 3) {
        lastX = camera.x;
        lastZ = camera.z;
        repack(camera.x, camera.z);
      }
    },
  };
}
