import { describe, it, expect } from 'vitest';
import {
  BoxGeometry,
  BufferAttribute,
  Color,
  DataTexture,
  DoubleSide,
  FrontSide,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  OrthographicCamera,
  PerspectiveCamera,
  PlaneGeometry,
  Raycaster,
  ShaderLib,
  Sphere,
  Vector3,
  type InstancedMesh,
  type Object3D,
  type WebGLProgramParametersWithUniforms,
  type WebGLRenderer,
  type WebGLRenderTarget,
} from 'three';
import {
  IMPOSTOR_BLEND,
  IMPOSTOR_LAYOUT,
  IMPOSTOR_SHADER_ANCHORS,
  bakeImpostor,
  bakeSource,
  billboardGeometry,
  createImpostorMaterial,
  frameBlend,
  frameDir,
  frameRect,
  frameUv,
  hasEmission,
  nodeSphere,
  switchJitter,
  tierOf,
  type BakeRenderer,
} from '../../src/observe/render/impostor';
import { lodProps } from '../../src/observe/render/instancer';
import { triangleBreakdown } from '../../src/observe/render/breakdown';
import { createToonMaterial } from '../../src/observe/render/toon';

const L = IMPOSTOR_LAYOUT;
const at = (x: number, z: number) => new Matrix4().makeTranslation(x, 0, z);
const close = (a: number, b: number, eps = 1e-6) => expect(Math.abs(a - b)).toBeLessThan(eps);

/** 原点から -z を見るカメラ (observe.cull.test.ts と同じ) */
function eye(): PerspectiveCamera {
  const c = new PerspectiveCamera(42, 16 / 9, 0.2, 2000);
  c.position.set(0, 2, 0);
  c.lookAt(0, 2, -1);
  c.updateMatrixWorld();
  return c;
}

/** 高さ 1 m・幅 1 m の箱を、根元を原点に置いたノード */
function boxNode(): Group {
  const g = new Group();
  g.add(new Mesh(new BoxGeometry(1, 1, 1).translate(0, 0.5, 0), new MeshBasicMaterial()));
  return g;
}

/** インポスターの板 (焼かずに形だけ。材質は何でもよい) */
function boardNode(): Mesh {
  return new Mesh(billboardGeometry(new Sphere(new Vector3(0, 0.5, 0), 0.87), L.pad), new MeshBasicMaterial());
}

/** 焼きの呼び出しを記録するだけの描き手 */
function fakeRenderer() {
  const calls: { target: WebGLRenderTarget | null; viewport: number[]; scissorTest: boolean; camera: OrthographicCamera; materials: string[] }[] = [];
  let target: WebGLRenderTarget | null = null;
  let clearColor = new Color(0.2, 0.3, 0.4);
  let clearAlpha = 1;
  const clears: WebGLRenderTarget[] = [];
  const r: BakeRenderer = {
    autoClear: true,
    shadowMap: { autoUpdate: true },
    getRenderTarget: () => target,
    setRenderTarget: (t) => void (target = t),
    getClearColor: (c) => c.copy(clearColor),
    getClearAlpha: () => clearAlpha,
    setClearColor: (c, a = 1) => {
      clearColor = new Color(c as Color);
      clearAlpha = a;
    },
    clear: () => void clears.push(target!),
    render: (scene, camera) => {
      const materials: string[] = [];
      scene.traverse((o) => (o as Mesh).isMesh && materials.push(((o as Mesh).material as { name: string }).name));
      calls.push({ target, viewport: target ? target.viewport.toArray() : [], scissorTest: !!target?.scissorTest, camera: camera.clone(), materials });
    },
  };
  return { r, calls, clears, state: () => ({ target, clearColor, clearAlpha }) };
}

/** 鐘樹の lod1 に似せたノード: 焼いた材質の塊 (頂点色・aEmissive)、絵で切り抜く葉のカード (両面)、両面の焼いた材質 */
function treeNode(glow: boolean): Group {
  const node = new Group();
  node.name = 'belltree_mature_lod1';
  node.position.set(5, 0, 5);
  const trunk = new BoxGeometry(0.5, 4, 0.5).translate(0, 2, 0);
  const n = trunk.getAttribute('position').count;
  trunk.setAttribute('color', new BufferAttribute(new Float32Array(n * 3).fill(0.8), 3));
  trunk.setAttribute('aEmissive', new BufferAttribute(new Float32Array(n * 3).fill(glow ? 0.3 : 0), 3));
  const baked = createToonMaterial({ vertexColors: true });
  baked.name = 'observe-baked';
  const lump = new Mesh(trunk, baked);
  const card = new Mesh(new PlaneGeometry(3, 3).translate(0, 5, 0), createToonMaterial({ map: new DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1), alphaTest: 0.5, side: DoubleSide }));
  card.material.name = 'belltree_foliage';
  const doubleBaked = createToonMaterial({ vertexColors: true, side: DoubleSide });
  const fin = new Mesh(new BoxGeometry(0.2, 0.2, 0.2), doubleBaked);
  node.add(lump, card, fin);
  return node;
}

describe('木の遠距離版 (インポスター、M23-06)', () => {
  it('枠の向き: 横 8 × 段 4 (0°・25°・50°・75°)。枠 (j, k) は木からカメラへの単位ベクトル', () => {
    expect(L.az).toBe(8);
    expect(L.el.map((e) => Math.round((e * 180) / Math.PI))).toEqual([0, 25, 50, 75]);
    const d = frameDir(L, 2, 0);
    close(d.x, 0);
    close(d.z, 1);
    close(d.length(), 1);
    close(frameDir(L, 0, 3).y, Math.sin((75 * Math.PI) / 180));
    expect(frameRect(L, 3, 2)).toEqual({ x: 768, y: 512, w: 256, h: 256 });
  });

  it('混ぜる枠: 枠の向きから見ればその枠だけ。枠の間は真ん中の 3 割だけ混ぜ、重みの和は 1。一周の継ぎ目と段の上下の外も扱う', () => {
    const only = (dir: Vector3) => frameBlend(L, dir).filter((f) => f.w > 1e-9);
    expect(only(frameDir(L, 3, 1))).toEqual([{ j: 3, k: 1, w: 1 }]);
    // 横の真ん中 (22.5°) は半々
    const mid = only(new Vector3(Math.cos(Math.PI / 8), 0, Math.sin(Math.PI / 8)));
    expect(mid.map((f) => [f.j, f.k])).toEqual([
      [0, 0],
      [1, 0],
    ]);
    mid.forEach((f) => close(f.w, 0.5));
    // 真ん中から外れた所 (枠の間の 2 割の位置) は近い枠だけ (幅 IMPOSTOR_BLEND = 0.3 の外)
    expect(IMPOSTOR_BLEND).toBe(0.3);
    const a = (0.2 * Math.PI * 2) / 8;
    expect(only(new Vector3(Math.cos(a), 0, Math.sin(a)))).toEqual([{ j: 0, k: 0, w: 1 }]);
    // 幅の内 (0.55) は線形: (0.55 - 0.5) / 0.3 + 0.5
    const b = (0.55 * Math.PI * 2) / 8;
    const w = frameBlend(L, new Vector3(Math.cos(b), 0, Math.sin(b)));
    close(w[1].w, 0.05 / 0.3 + 0.5);
    close(w.reduce((s, f) => s + f.w, 0), 1);
    // 一周の継ぎ目 (-22°、枠 7 と 0 の真ん中の近く) は枠 7 と 0
    const c = (-22 * Math.PI) / 180;
    expect(new Set(only(new Vector3(Math.cos(c), 0, Math.sin(c))).map((f) => f.j))).toEqual(new Set([7, 0]));
    // 見上げ (段 0 より下) は段 0、真上は段 3
    expect(only(new Vector3(1, -0.5, 0).normalize()).map((f) => f.k)).toEqual([0]);
    expect(only(new Vector3(0, 1, 0)).map((f) => f.k)).toEqual([3]);
    // 線形に全部混ぜる幅 1
    const lin = frameBlend(L, new Vector3(Math.cos(a), 0, Math.sin(a)), 1);
    close(lin[1].w, 0.2);
  });

  it('枠の uv: 視線に沿って枠の面へ写す。枠の向きから見れば平行投影、ずれた向きでも枠の面の上の点は同じ所に写る', () => {
    const r = 5;
    const d = frameDir(L, 1, 1);
    const right = new Vector3(0, 1, 0).cross(d).normalize();
    const up = d.clone().cross(right);
    // 木の中心は真ん中
    expect(frameUv(new Vector3(), d, d, r)).toEqual([0.5, 0.5]);
    // 枠の向きから見れば、板の点は平行投影のまま
    const [u, v] = frameUv(right.clone().multiplyScalar(2.5), d, d, r);
    close(u, 0.75);
    close(v, 0.5);
    // 枠の面の上の点 x を、20° ずれた向き view から見る: 板の上で x に重なる点 q は枠の中で x と同じ uv
    const x = right.clone().multiplyScalar(1.5).addScaledVector(up, -2);
    const view = d.clone().applyAxisAngle(new Vector3(0, 1, 0), (20 * Math.PI) / 180).normalize();
    const q = x.clone().addScaledVector(view, -x.dot(view));
    const [qu, qv] = frameUv(q, view, d, r);
    close(qu, 0.5 + (0.5 * 1.5) / r);
    close(qv, 0.5 - (0.5 * 2) / r);
  });

  it('切り替えの距離の揺らぎ: 置き場所で決まり (植え直しても同じ)、-0.5〜0.5 に散らばる。段は近い・遠い・インポスター', () => {
    expect(switchJitter(12.3, -40.1)).toBe(switchJitter(12.3, -40.1));
    const js = Array.from({ length: 400 }, (_, i) => switchJitter((i % 20) * 3.7 - 30, Math.floor(i / 20) * 4.1 - 40));
    expect(Math.min(...js)).toBeGreaterThanOrEqual(-0.5);
    expect(Math.max(...js)).toBeLessThan(0.5);
    expect(Math.min(...js)).toBeLessThan(-0.4);
    expect(Math.max(...js)).toBeGreaterThan(0.4);
    close(js.reduce((s, j) => s + j, 0) / js.length, 0, 0.05);
    expect(new Set(js.map((j) => j.toFixed(6))).size).toBeGreaterThan(390);
    expect([tierOf(10, 38, 60), tierOf(38, 38, 60), tierOf(59.9, 38, 60), tierOf(60, 38, 60), tierOf(500, 38, 0)]).toEqual([0, 1, 1, 2, 1]);
  });

  it('木の球は node の座標で頂点から測る (node の置き場所に依らない)', () => {
    const node = treeNode(true);
    const ball = nodeSphere(node);
    // 高さは小さな箱の下端 -0.1 m からカードの上端 6.5 m、幅はカードの 3 m
    close(ball.center.y, 3.2, 1e-5);
    close(ball.center.x, 0);
    expect(ball.radius).toBeGreaterThan(3.3);
    expect(ball.radius).toBeLessThan(3.8);
  });

  it('焼きの材質の作り分け: 葉のカードは絵で切り抜き法線を裏返さない。両面の焼いた材質は裏を返す。発光は aEmissive か材質の発光', () => {
    const [lump, card, fin] = treeNode(true).children as Mesh[];
    const l = bakeSource(lump);
    expect([l.alphaTest, l.vertexColors, l.hasEmissiveAttr, l.flipBack, l.side]).toEqual([0, true, true, false, FrontSide]);
    const c = bakeSource(card);
    expect([c.alphaTest, !!c.map, c.flipBack, c.side]).toEqual([0.5, true, false, DoubleSide]);
    expect(bakeSource(fin).flipBack).toBe(true);
    expect(hasEmission(treeNode(true))).toBe(true);
    expect(hasEmission(treeNode(false))).toBe(false);
    const lit = new Group();
    lit.add(new Mesh(new BoxGeometry(), createToonMaterial({ emissive: new Color('#FFC46B'), emissiveIntensity: 0.4 })));
    expect(hasEmission(lit)).toBe(true);
  });

  it('焼き: 色・法線と奥行き・発光を 32 枠ずつ、枠の向きから平行投影で描き、描き手の状態を戻す。発光の無い木は 2 枚', () => {
    const f = fakeRenderer();
    const node = treeNode(true);
    const imp = bakeImpostor(f.r, node);
    expect(f.calls).toHaveLength(3 * 32);
    const targets = [...new Set(f.calls.map((c) => c.target))];
    expect(targets).toHaveLength(3);
    expect(f.clears).toEqual(targets);
    expect(targets.map((t) => [t!.width, t!.height])).toEqual([
      [2048, 1024],
      [2048, 1024],
      [2048, 1024],
    ]);
    expect([f.calls[0].materials[0], f.calls[32].materials[0], f.calls[64].materials[0]]).toEqual(['impostor-bake-albedo', 'impostor-bake-normal', 'impostor-bake-emissive']);
    const ball = imp.sphere;
    const r = ball.radius * L.pad;
    for (const [i, c] of f.calls.slice(0, 32).entries()) {
      const j = i % 8;
      const k = Math.floor(i / 8);
      expect(c.viewport).toEqual([j * 256, k * 256, 256, 256]);
      expect(c.scissorTest).toBe(true);
      // 平行投影の枠は木の球 × 余白、カメラは枠の向きから木の中心を見る
      expect([c.camera.left, c.camera.right, c.camera.top, c.camera.bottom]).toEqual([-r, r, r, -r]);
      const dir = c.camera.position.clone().sub(ball.center).normalize();
      const want = frameDir(L, j, k);
      close(dir.distanceTo(want), 0, 1e-6);
      const look = new Vector3(0, 0, -1).applyQuaternion(c.camera.quaternion);
      close(look.dot(want), -1, 1e-6);
    }
    // 描き手の状態は元どおり
    expect(f.state().target).toBeNull();
    expect(f.state().clearColor.getHex()).toBe(new Color(0.2, 0.3, 0.4).getHex());
    expect(f.r.autoClear).toBe(true);
    expect(f.r.shadowMap.autoUpdate).toBe(true);
    // 板は 2 三角形、境界の球は木の球 × 余白 (視錐台の判定と内訳の inView に使う)
    expect(imp.mesh.geometry.index!.count / 3).toBe(2);
    expect(imp.mesh.geometry.boundingSphere!.radius).toBeCloseTo(r, 6);
    expect(imp.mesh.material).toMatchObject({ name: 'observe-impostor' });
    expect(imp.textures.emissive).not.toBeNull();
    // 発光の無い木 (森の木) は色・法線の 2 枚
    const g = fakeRenderer();
    const plain = bakeImpostor(g.r, treeNode(false));
    expect(g.calls).toHaveLength(2 * 32);
    expect(plain.textures.emissive).toBeNull();
  });

  it('板の材質: toon のシェーダーに書き換えの目印が全部あり、板の向き・4 枠の読み・深度・影のずれ・夜の発光を入れる', () => {
    for (const a of IMPOSTOR_SHADER_ANCHORS) expect(ShaderLib.toon.vertexShader.includes(a) || ShaderLib.toon.fragmentShader.includes(a)).toBe(true);
    const f = fakeRenderer();
    const imp = bakeImpostor(f.r, treeNode(true));
    const m = imp.mesh.material as ReturnType<typeof createImpostorMaterial>;
    const shader = { uniforms: {}, vertexShader: ShaderLib.toon.vertexShader, fragmentShader: ShaderLib.toon.fragmentShader } as unknown as WebGLProgramParametersWithUniforms;
    m.onBeforeCompile(shader, {} as WebGLRenderer);
    expect(shader.vertexShader).toContain('vec4 mvPosition = viewMatrix * vec4(impP, 1.0);');
    expect(shader.vertexShader).toContain('worldPosition = vec4(impP, 1.0);');
    expect(shader.vertexShader).toContain('#define IMP_AZ 8');
    expect(shader.fragmentShader).toContain('#define IMP_EMISSIVE');
    expect(shader.fragmentShader.match(/impAddFrame\(vImpFrame/g)).toHaveLength(4);
    expect(shader.fragmentShader).toContain('gl_FragDepth');
    expect(shader.fragmentShader).toContain('vImpShadowShift * impDepth');
    expect(shader.fragmentShader).toContain('totalEmissiveRadiance = impE * uImpGlow;');
    expect(shader.fragmentShader).toContain('normal = impNormalView;');
    // 夜の灯り (bake.ts の glow) と同じ uniform を共有する
    const u = shader.uniforms as Record<string, { value: unknown }>;
    expect(u.uImpGlow).toBe(m.userData.impostor.uImpGlow);
    expect(u.uImpAlbedo.value).toBe(imp.textures.albedo);
    expect(u.uImpBlend.value).toBe(IMPOSTOR_BLEND);
    // 発光の無い木は発光を読まない。プログラムの鍵も分ける
    const plain = bakeImpostor(fakeRenderer().r, treeNode(false)).mesh.material as ReturnType<typeof createImpostorMaterial>;
    expect(plain.customProgramCacheKey()).not.toBe(m.customProgramCacheKey());
  });

  it('木 (lodProps): 3 段。インポスターの段の木は板で描き、遠い組の見えない側に残して影と光線の当たり判定は今までどおり', () => {
    // 近い 10 m、遠い 45 m、インポスター 80 m と 200 m (前)、後ろ 80 m
    const placements = [at(0, -10), at(0, -45), at(0, -80), at(0, -200), at(0, 80)];
    const l = lodProps(boxNode(), boxNode(), placements, 38, placements.length, null, { node: boardNode(), farM: 60 });
    expect(l.impostor).not.toBeNull();
    const [near, far, imp] = [l.group.children[0], l.group.children[1], l.impostor!].map((g) => g.children[0] as InstancedMesh);
    l.update(eye());
    expect([near.count, near.userData.shadowCount]).toEqual([1, 1]);
    // 遠い組: 本の描画は 45 m の 1 本、影と当たり判定は近くない全部の 4 本
    expect([far.count, far.userData.shadowCount]).toEqual([1, 4]);
    // インポスター: 前の 2 本 (後ろは描かない)。影は落とさない
    expect(imp.count).toBe(2);
    expect(imp.castShadow).toBe(false);
    const m = new Matrix4();
    const p = new Vector3();
    const zs = [0, 1].map((i) => (imp.getMatrixAt(i, m), p.setFromMatrixPosition(m).z));
    expect(zs).toEqual([-80, -200]);
    // 光線は板に当たらず、遠い組の全部の木 (インポスターの段も) に当たる
    l.group.updateMatrixWorld(true);
    const hit = new Raycaster(new Vector3(0, 0.5, -60), new Vector3(0, 0, -1)).intersectObject(l.group, true);
    expect(new Set(hit.map((h) => h.object))).toEqual(new Set([far]));
    expect(new Set(hit.map((h) => Math.round(h.point.z / 10) * 10))).toEqual(new Set([-80, -200]));
    // 後ろ (画面の外) のインポスターの段の木にも当たる (自動カメラの遮り)
    const back = new Raycaster(new Vector3(0, 0.5, 60), new Vector3(0, 0, 1)).intersectObject(l.group, true);
    expect(back.length).toBeGreaterThan(0);
    expect(new Set(back.map((h) => h.object))).toEqual(new Set([far]));
  });

  it('切り替えの距離は木ごとに farM × (1 + 0.2 × 揺らぎ)。植え直しても同じ木は同じ距離で切り替わる', () => {
    const spots = Array.from({ length: 40 }, (_, i) => [(i - 20) * 1.3, -(50 + i * 0.5)] as const);
    const placements = spots.map(([x, z]) => at(x, z));
    const l = lodProps(boxNode(), boxNode(), placements, 38, 80, null, { node: boardNode(), farM: 60 });
    const imp = l.impostor!.children[0] as InstancedMesh;
    const camera = eye();
    const want = (pts: readonly (readonly [number, number])[]) =>
      pts.filter(([x, z]) => tierOf(Math.hypot(x, z), 38, 60 * (1 + 0.2 * switchJitter(x, z))) === 2).length;
    l.update(camera);
    expect(imp.count).toBe(want(spots));
    // 60 m の輪の内と外の両方で切り替わる木がある (輪に並ばない)
    const ds = spots.filter(([x, z]) => tierOf(Math.hypot(x, z), 38, 60 * (1 + 0.2 * switchJitter(x, z))) === 2).map(([x, z]) => Math.hypot(x, z));
    expect(Math.min(...ds)).toBeLessThan(60);
    expect(spots.some(([x, z]) => Math.hypot(x, z) > 60 && tierOf(Math.hypot(x, z), 38, 60 * (1 + 0.2 * switchJitter(x, z))) === 1)).toBe(true);
    // 植え直し (半分を入れ替え、順も変える): 残った木の段は置き場所で決まる
    const next = [...spots.slice(20).reverse(), ...Array.from({ length: 10 }, (_, i) => [i * 2 - 10, -70] as const)];
    l.setPlacements(next.map(([x, z]) => at(x, z)));
    l.update(camera);
    expect(imp.count).toBe(want(next));
  });

  it('far を渡さなければ今までどおり 2 段 (インポスターの組は無い)', () => {
    const l = lodProps(boxNode(), boxNode(), [at(0, -10), at(0, -200)], 38);
    expect(l.impostor).toBeNull();
    expect(l.group.children).toHaveLength(2);
    l.update(eye());
    const far = l.group.children[1].children[0] as InstancedMesh;
    expect(far.count).toBe(1);
  });

  it('内訳: インポスターは木の区分の本の描画に 1 本 2 三角形で数え、影には数えない', () => {
    const l = lodProps(boxNode(), boxNode(), [at(0, -10), at(0, -80), at(0, -120)], 38, 3, null, { node: boardNode(), farM: 60 });
    const scene = new Group();
    scene.add(l.group);
    const camera = eye();
    l.update(camera);
    const rows = triangleBreakdown(camera, { belltree: [l.group] }, scene as Object3D);
    // 近い箱 12 + インポスター 2 本 × 2。遠い組の本の描画は 0 本、影は近い 1 本 + 遠い組の 2 本
    expect(rows.belltree.drawn).toBe(12 + 4);
    expect(rows.belltree.shadow).toBe(12 * 3);
  });
});
