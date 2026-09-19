import {
  AmbientLight,
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
import type { AssetTable } from './assetTable';

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
    new MeshLambertMaterial({ color: '#2E6F9E', transparent: true, opacity: 0.55, side: DoubleSide }),
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
      for (let i = 0; i < n; i++) p.setY(i, Math.max(s.layers.elevation[i], SEA_LEVEL) * hs);
      p.needsUpdate = true;
      geo.computeVertexNormals();
      const c = geo.getAttribute('color') as BufferAttribute;
      c.set(layerToColors(s, layer, colorBuf));
      c.needsUpdate = true;
      for (const d of s.species) {
        const m = inst[d.assetId];
        if (!m) continue;
        const a = opts.assets[d.assetId];
        const count = scatterInstances(s.layers.populations[d.id], s.layers.elevation, size, 2, 1, pos);
        for (let k = 0; k < count; k++) {
          dummy.position.set(pos[k * 3], pos[k * 3 + 1] * hs, pos[k * 3 + 2]);
          dummy.scale.setScalar(a.scale);
          dummy.updateMatrix();
          m.setMatrixAt(k, dummy.matrix);
        }
        m.count = count;
        m.instanceMatrix.needsUpdate = true;
      }
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
    },
  };
}
