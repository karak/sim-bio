import { CanvasTexture, Color, DirectionalLight, Fog, HemisphereLight, Mesh, PCFShadowMap, PerspectiveCamera, Scene, SRGBColorSpace, Texture, WebGLRenderer } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { TerrainField } from '../render/terrain';
import { createGrade, type Grade } from '../render/grade';
import { installShadowOnly, type ShadowOnly } from '../render/shadowOnly';
import { AtmospherePass, createSky, type Sky } from '../render/atmosphere';
import { OPT } from './options';

function skyTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 256;
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#7FA9C9');
  grad.addColorStop(0.55, '#CFE0E4');
  grad.addColorStop(1, '#F3E3C4');
  g.fillStyle = grad;
  g.fillRect(0, 0, 4, 256);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

export type Stage = {
  renderer: WebGLRenderer;
  shadowOnly: ShadowOnly;
  scene: Scene;
  sky: Sky | null;
  camera: PerspectiveCamera;
  controls: OrbitControls;
  hemi: HemisphereLight;
  sun: DirectionalLight;
};

export function createStage(canvas: HTMLCanvasElement, field: TerrainField): Stage {
  // (M23-07 で変更: 画面 (canvas) の MSAA を切る。描画はすべて合成 (grade.ts) を通り、MSAA は場面の描画先が持つ。画面の MSAA は最後の全画面の 1 枚にしか掛からず、解決の分だけ重かった)
  const renderer = new WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  // (M23-07 で変更: ピクセル比の上限は OPT.pr)
  renderer.setPixelRatio(Math.min(OPT.pr, window.devicePixelRatio));
  renderer.shadowMap.enabled = OPT.shadow;
  renderer.shadowMap.type = PCFShadowMap;
  // (M23-04) 影の描画だけに出す粗い代わりの形 (鐘樹の成木・小屋・近くの動物)。本の描画の形は castShadow = false にする
  const shadowOnly = installShadowOnly(renderer.shadowMap);
  const scene = new Scene();
  scene.background = skyTexture();
  // 霧の色は空の地平の帯に合わせ、水面の端 (区域の外の遠景) を地平に溶かす
  scene.fog = new Fog(new Color('#D9E4E2'), 80, 320);
  // (M22-07: 空気の層を使うときは、空は昼夜で変わる球、霧は後段の霞と靄が受け持つ)
  const sky = OPT.air ? createSky() : null;
  if (sky) {
    scene.background = null;
    scene.fog = null;
    scene.add(sky.mesh);
  }
  // (M22-07: 空気の層で水面の果て 1.5 km まで霞ませるので、遠くの切り捨てを 800 m から 2 km に)
  const camera = new PerspectiveCamera(42, 1, 0.2, 2000);
  camera.position.set(-26, field.heightAt(-26, 44) + 6, 44);
  const controls = new OrbitControls(camera, canvas);
  controls.target.set(2, field.heightAt(2, 0) + 3, 0);
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI / 2 - 0.08;
  controls.minDistance = 4;
  controls.maxDistance = 160;

  const hemi = new HemisphereLight(new Color('#D7E8F2'), new Color('#6F7A4E'), 1.1);
  scene.add(hemi);
  const sun = new DirectionalLight(new Color('#FFE3B6'), 2.4);
  sun.position.set(-60, 70, 40);
  sun.castShadow = OPT.shadow;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -100;
  sc.right = 100;
  sc.top = 100;
  sc.bottom = -100;
  sc.far = 300;
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.6;
  scene.add(sun);
  return { renderer, shadowOnly, scene, sky, camera, controls, hemi, sun };
}

export type Composite = { air: AtmospherePass | null; grade: Grade; resize(): void };

export function createComposite({ renderer, scene, camera, sun }: Stage, canvas: HTMLCanvasElement): Composite {
  // (M23-07 で変更: 空気の層は既定で場面の半分の大きさで描く (OPT.airScale))
  const air = OPT.air ? new AtmospherePass(camera, sun, OPT.airScale) : null;
  // (M23-07 で変更: 場面の MSAA の段を渡す)
  const grade = createGrade(renderer, scene, camera, air ? [air] : [], { msaa: OPT.msaa });
  grade.setEnabled({ grade: OPT.grade, bloom: OPT.bloom });
  const resize = () => {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    grade.setSize(w, h);
  };
  window.addEventListener('resize', resize);
  resize();
  return { air, grade, resize };
}

export function disposeStage({ renderer, scene, controls }: Stage, resize: () => void): void {
  window.removeEventListener('resize', resize);
  controls.dispose();
  scene.traverse((o) => {
    const m = o as Mesh;
    m.geometry?.dispose();
    for (const mat of Array.isArray(m.material) ? m.material : m.material ? [m.material] : []) {
      for (const v of Object.values(mat)) if (v && (v as Texture).isTexture) (v as Texture).dispose();
      mat.dispose();
    }
  });
  (scene.background as Texture | null)?.dispose?.();
  renderer.dispose();
  renderer.forceContextLoss();
}
