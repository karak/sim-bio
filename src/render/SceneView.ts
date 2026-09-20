import {
  AmbientLight,
  BoxGeometry,
  BufferAttribute,
  Color,
  DirectionalLight,
  DoubleSide,
  InstancedMesh,
  Mesh,
  MeshLambertMaterial,
  Object3D,
  PerspectiveCamera,
  PlaneGeometry,
  Raycaster,
  Scene,
  Vector2,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { WorldSnapshot } from '../simulation/types';
import { SEA_LEVEL } from '../simulation/terrain';
import { layerToColors, type LayerKind } from './layerToColors';
import { scatterInstances } from './scatter';
import { settlementInstances } from './settlement';
import type { AssetTable } from './assetTable';

/** 集落の箱 1 個の寸法。stage の数だけ縦に積む */
const SETTLEMENT_BOX = { width: 0.5, height: 0.4, depth: 0.5 };
/** 文明は 0..7 段階なので最大でもこれだけあれば足りる */
const SETTLEMENT_MAX_STAGE = 8;

export type SceneView = {
  /** 毎フレーム呼ぶ。tick かレイヤーが変わった時だけ頂点色とインスタンスを更新する */
  update(s: WorldSnapshot): void;
  setLayer(l: LayerKind): void;
  getLayer(): LayerKind;
  /** クライアント座標からセル index。地形に当たらなければ null */
  pickCell(clientX: number, clientY: number): number | null;
  resize(): void;
  dispose(): void;
};

export type SceneViewOptions = {
  assets: AssetTable;
  size: number;
  heightScale?: number;
  maxInstances?: number;
};

/** Three.js を完全に隠す。World の snapshot を読んで描くだけ。 */
export function createSceneView(canvas: HTMLCanvasElement, opts: SceneViewOptions): SceneView {
  const size = opts.size;
  const hs = opts.heightScale ?? 12;
  const maxInst = opts.maxInstances ?? 20000;
  const n = size * size;

  const renderer = new WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
  const scene = new Scene();
  scene.background = new Color('#1B2B3A');
  const camera = new PerspectiveCamera(50, 1, 0.1, 1000);
  camera.position.set(0, size * 0.9, size * 0.9);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI / 2 - 0.05;
  controls.minDistance = 5;
  controls.maxDistance = size * 2.5;

  scene.add(new AmbientLight(0xffffff, 0.6));
  const sun = new DirectionalLight(0xffffff, 1.2);
  sun.position.set(size, size, size * 0.5);
  scene.add(sun);

  // 地形: PlaneGeometry は行優先 (y=0 が奥)。rotateX(-90°) で z が奥行きになる。
  const geo = new PlaneGeometry(size, size, size - 1, size - 1);
  geo.rotateX(-Math.PI / 2);
  geo.setAttribute('color', new BufferAttribute(new Float32Array(n * 3), 3));
  const terrain = new Mesh(geo, new MeshLambertMaterial({ vertexColors: true }));
  scene.add(terrain);

  const sea = new Mesh(
    new PlaneGeometry(size * 3, size * 3),
    new MeshLambertMaterial({ color: '#2E6F9E', transparent: true, opacity: 0.7, side: DoubleSide, depthWrite: false }),
  );
  sea.rotateX(-Math.PI / 2);
  sea.position.y = SEA_LEVEL * hs + 0.02;
  scene.add(sea);

  const inst: Record<string, InstancedMesh> = {};
  for (const [id, a] of Object.entries(opts.assets)) {
    const m = new InstancedMesh(a.geometry, a.material, maxInst);
    m.count = 0;
    m.frustumCulled = false;
    inst[id] = m;
    scene.add(m);
  }
  const pos = new Float32Array(maxInst * 3);
  const dummy = new Object3D();

  // 集落: 段階の数だけ積んだ小さな箱。文明なし・stage 0 では count 0 になり何も描かれない (M8-04)
  const settlementGeo = new BoxGeometry(SETTLEMENT_BOX.width, SETTLEMENT_BOX.height, SETTLEMENT_BOX.depth);
  const settlementMesh = new InstancedMesh(settlementGeo, new MeshLambertMaterial({ color: '#C9A24B' }), SETTLEMENT_MAX_STAGE);
  settlementMesh.count = 0;
  settlementMesh.frustumCulled = false;
  scene.add(settlementMesh);

  let layer: LayerKind = 'terrain';
  let lastTick = -1;
  let lastLayer: LayerKind | null = null;
  const colorBuf = new Float32Array(n * 3);

  const resize = () => {
    const w = canvas.clientWidth || 1;
    const h = canvas.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  resize();
  window.addEventListener('resize', resize);

  const clampTarget = () => {
    const lim = size / 2;
    controls.target.x = Math.max(-lim, Math.min(lim, controls.target.x));
    controls.target.z = Math.max(-lim, Math.min(lim, controls.target.z));
    controls.target.y = 0;
  };

  const update = (s: WorldSnapshot) => {
    if (s.tick !== lastTick || layer !== lastLayer) {
      const p = geo.getAttribute('position') as BufferAttribute;
      // 海底も実標高で描き、半透明の海面を上に重ねる (平らにすると海面と Z ファイトする)
      for (let i = 0; i < n; i++) p.setY(i, s.layers.elevation[i] * hs);
      p.needsUpdate = true;
      geo.computeVertexNormals();
      const c = geo.getAttribute('color') as BufferAttribute;
      c.set(layerToColors(s, layer, colorBuf));
      c.needsUpdate = true;
      for (const d of s.species) {
        const m = inst[d.assetId];
        if (!m) continue;
        const a = opts.assets[d.assetId];
        const count = scatterInstances(s.layers.populations[d.id], s.layers.elevation, size, a.perCell, 1, pos);
        for (let k = 0; k < count; k++) {
          // ジオメトリ原点が中心なので高さの半分だけ持ち上げる
          dummy.position.set(pos[k * 3], pos[k * 3 + 1] * hs + 0.3 * a.scale, pos[k * 3 + 2]);
          dummy.scale.setScalar(a.scale);
          dummy.updateMatrix();
          m.setMatrixAt(k, dummy.matrix);
        }
        m.count = count;
        m.instanceMatrix.needsUpdate = true;
      }
      const settlement = settlementInstances(s.civ, size);
      if (settlement.count > 0) {
        const cx = settlement.cell % size;
        const cy = (settlement.cell - cx) / size;
        const baseY = s.layers.elevation[settlement.cell] * hs;
        for (let k = 0; k < settlement.count; k++) {
          dummy.position.set(cx - size / 2 + 0.5, baseY + (k + 0.5) * SETTLEMENT_BOX.height, cy - size / 2 + 0.5);
          dummy.scale.setScalar(1);
          dummy.updateMatrix();
          settlementMesh.setMatrixAt(k, dummy.matrix);
        }
      }
      settlementMesh.count = settlement.count;
      settlementMesh.instanceMatrix.needsUpdate = true;
      lastTick = s.tick;
      lastLayer = layer;
    }
    clampTarget();
    controls.update();
    renderer.render(scene, camera);
  };

  const ray = new Raycaster();
  const ndc = new Vector2();
  const pickCell = (cx: number, cy: number): number | null => {
    const r = canvas.getBoundingClientRect();
    ndc.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObject(terrain, false)[0];
    if (!hit) return null;
    const x = Math.floor(hit.point.x + size / 2);
    const y = Math.floor(hit.point.z + size / 2);
    if (x < 0 || y < 0 || x >= size || y >= size) return null;
    return y * size + x;
  };

  return {
    update,
    setLayer: (l) => {
      layer = l;
    },
    getLayer: () => layer,
    pickCell,
    resize,
    dispose: () => {
      window.removeEventListener('resize', resize);
      controls.dispose();
      renderer.dispose();
      geo.dispose();
      settlementGeo.dispose();
    },
  };
}
