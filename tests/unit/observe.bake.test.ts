import { describe, it, expect } from 'vitest';
import { BoxGeometry, Color, DoubleSide, Group, Mesh, ShaderLib, type BufferAttribute } from 'three';
import { bakeMaterials, glow } from '../../src/observe/render/bake';
import { createToonMaterial } from '../../src/observe/render/toon';
import { grassKeep } from '../../src/observe/render/grass';

const toon = (color: string, emissive = '#000000', emissiveIntensity = 1) => createToonMaterial({ color, emissive: new Color(emissive), emissiveIntensity });

describe('観察画面 (M22-03): 材質を頂点に焼く', () => {
  it('同じノードの材質違いのメッシュを 1 つにまとめ、色と発光を頂点に移す。両面は別にまとめ、半透明は残す', () => {
    const root = new Group();
    const node = new Group();
    node.name = 'hut';
    root.add(node);
    const a = new Mesh(new BoxGeometry(1, 1, 1), toon('#FF0000'));
    const b = new Mesh(new BoxGeometry(1, 1, 1), toon('#000000', '#00FF00', 0.5));
    b.position.set(2, 0, 0);
    const d = new Mesh(new BoxGeometry(1, 1, 1), createToonMaterial({ color: '#0000FF', side: DoubleSide }));
    const glass = new Mesh(new BoxGeometry(1, 1, 1), createToonMaterial({ color: '#FFFFFF', transparent: true, opacity: 0.2 }));
    node.add(a, b, d, glass);
    bakeMaterials(root);
    // 片面の a と b は 1 つに、両面の d は 1 つだけなのでその場で焼き、半透明の glass はそのまま
    const meshes = node.children as Mesh[];
    expect(meshes.length).toBe(3);
    expect(meshes).toContain(glass);
    expect(meshes).toContain(d);
    const merged = meshes.find((m) => m.name === 'hut_baked')!;
    const pos = merged.geometry.getAttribute('position') as BufferAttribute;
    const col = merged.geometry.getAttribute('color') as BufferAttribute;
    const emi = merged.geometry.getAttribute('aEmissive') as BufferAttribute;
    expect(pos.count).toBe(48);
    // a の頂点は赤、発光なし。b の頂点は親の座標 (x + 2) に移り、黒で緑に 0.5 光る
    const red = new Color('#FF0000');
    expect([col.getX(0), col.getY(0), col.getZ(0)]).toEqual([red.r, red.g, red.b]);
    expect(emi.getY(0)).toBe(0);
    expect(pos.getX(24)).toBeGreaterThan(1.4);
    expect(col.getX(24)).toBe(0);
    expect(emi.getY(24)).toBeCloseTo(0.5);
    // 焼いた材質は共有で、発光に uGlow が掛かる
    expect((d.material as { side: number }).side).toBe(DoubleSide);
    expect(d.geometry.getAttribute('aEmissive')).toBeDefined();
    expect(glass.geometry.getAttribute('aEmissive')).toBeUndefined();
    expect(glow.value).toBe(1);
  });

  it('root の直下のメッシュ (別々のノード) はまとめず、その場で焼いて名前を保つ', () => {
    const root = new Group();
    const fern = new Mesh(new BoxGeometry(1, 1, 1), toon('#00FF00'));
    fern.name = 'fern';
    const tuft = new Mesh(new BoxGeometry(1, 1, 1), toon('#FFFF00'));
    tuft.name = 'grass_tuft';
    root.add(fern, tuft);
    bakeMaterials(root);
    expect(root.children).toEqual([fern, tuft]);
    expect(fern.geometry.getAttribute('aEmissive')).toBeDefined();
    expect(fern.material).toBe(tuft.material);
  });
});

describe('観察画面 (遠距離版の追加): 薄い葉の両面の材質', () => {
  it('flora_under で始まる両面の材質は、裏の法線を裏返さない別の共有の材質に焼く。他の両面と片面はそのまま', () => {
    const root = new Group();
    const node = new Group();
    node.name = 'fern';
    root.add(node);
    const leafMat = (name: string) => {
      const m = createToonMaterial({ color: '#00FF00', side: DoubleSide });
      m.name = name;
      return m;
    };
    const leafA = new Mesh(new BoxGeometry(1, 1, 1), leafMat('flora_under'));
    const leafB = new Mesh(new BoxGeometry(1, 1, 1), leafMat('flora_under'));
    leafB.position.set(2, 0, 0);
    const sail = new Mesh(new BoxGeometry(1, 1, 1), leafMat('ship_sail'));
    const sail2 = new Mesh(new BoxGeometry(1, 1, 1), leafMat('ship_sail'));
    node.add(leafA, leafB, sail, sail2);
    bakeMaterials(root);
    const meshes = node.children as Mesh[];
    // 葉の 2 つと帆の 2 つは別々の組にまとまる
    expect(meshes.length).toBe(2);
    const names = meshes.map((m) => (m.material as { name: string }).name).sort();
    expect(names).toEqual(['observe-baked-double', 'observe-baked-leaf']);
    const leaf = meshes.find((m) => (m.material as { name: string }).name === 'observe-baked-leaf')!;
    expect((leaf.material as { side: number }).side).toBe(DoubleSide);
    expect(leaf.geometry.getAttribute('position').count).toBe(48);
    // シェーダーの控え (program cache) も分ける
    const key = (m: Mesh) => (m.material as { customProgramCacheKey(): string }).customProgramCacheKey();
    expect(key(meshes[0])).not.toBe(key(meshes[1]));
    expect(key(leaf)).toContain('leaf');
  });
});

describe('観察画面 (M22-11): 樹皮と木口の属性', () => {
  const named = (name: string) => {
    const m = toon('#FFFFFF');
    m.name = name;
    return m;
  };
  /** 箱の UV を (0.25, 0.75) にそろえる (glTF の UV は v が 1 - v で来る) */
  const withUv = (g: BoxGeometry) => {
    const uv = g.getAttribute('uv') as BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, 0.25, 0.75);
    return g;
  };

  it('樹皮の材質は UV と種類 1、木口は種類 2 を aWood に持ち (v は 1 - v に戻す)、他の材質は UV があっても 0', () => {
    const root = new Group();
    const node = new Group();
    node.name = 'belltree_stump';
    root.add(node);
    const bark = new Mesh(withUv(new BoxGeometry(1, 1, 1)), named('belltree_trunk'));
    const end = new Mesh(withUv(new BoxGeometry(1, 1, 1)), named('belltree_endgrain'));
    end.position.set(2, 0, 0);
    const forest = new Mesh(withUv(new BoxGeometry(1, 1, 1)), named('flora_forest_bark'));
    forest.position.set(4, 0, 0);
    const ground = new Mesh(withUv(new BoxGeometry(1, 1, 1)), named('belltree_ground'));
    ground.position.set(6, 0, 0);
    node.add(bark, end, forest, ground);
    bakeMaterials(root);
    expect(node.children.length).toBe(1);
    const merged = node.children[0] as Mesh;
    const wood = merged.geometry.getAttribute('aWood') as BufferAttribute;
    expect(wood.count).toBe(96);
    const at = (i: number) => [wood.getX(i), wood.getY(i), wood.getZ(i)];
    expect(at(0)).toEqual([0.25, 0.25, 1]);
    expect(at(24)).toEqual([0.25, 0.25, 2]);
    expect(at(48)).toEqual([0.25, 0.25, 1]);
    expect(at(72)).toEqual([0, 0, 0]);
    // 樹皮の材質でも UV が無ければ 0 (筆致を足さない)
    const lone = new Group();
    const noUv = new BoxGeometry(1, 1, 1);
    noUv.deleteAttribute('uv');
    const m = new Mesh(noUv, named('belltree_trunk'));
    lone.add(m);
    bakeMaterials(lone);
    expect((m.geometry.getAttribute('aWood') as BufferAttribute).getZ(0)).toBe(0);
  });

  it('共有の材質のシェーダは aWood を受け、樹皮の升で色と法線を足す (three のシェーダの差し込み先が今もある)', () => {
    const root = new Group();
    const mesh = new Mesh(new BoxGeometry(1, 1, 1), named('belltree_trunk'));
    root.add(mesh);
    bakeMaterials(root);
    const mat = mesh.material as unknown as { onBeforeCompile(s: { uniforms: Record<string, unknown>; vertexShader: string; fragmentShader: string }, r: unknown): void };
    const shader = { uniforms: {} as Record<string, unknown>, vertexShader: ShaderLib.toon.vertexShader, fragmentShader: ShaderLib.toon.fragmentShader };
    mat.onBeforeCompile(shader, {});
    expect(shader.vertexShader).toContain('vWood = aWood;');
    expect(shader.fragmentShader).toContain('wT = textureGrad(uBark, wUv, wDx, wDy);');
    expect(shader.fragmentShader).toContain('normal = normalize(abs(wDet) * normal');
    expect(shader.uniforms.uBark).toBeDefined();
  });
});

describe('観察画面 (M22-03): 草の間引き', () => {
  it('28 m までは全部、70 m で 3 割、110 m 先は 2 割。途中は切れ目なく減る', () => {
    expect(grassKeep(0)).toBe(1);
    expect(grassKeep(28)).toBe(1);
    expect(grassKeep(49)).toBeCloseTo(0.65);
    expect(grassKeep(70)).toBeCloseTo(0.3);
    expect(grassKeep(110)).toBeCloseTo(0.2);
    expect(grassKeep(200)).toBe(0.2);
    for (let d = 0; d < 150; d += 0.5) {
      expect(grassKeep(d + 0.5)).toBeLessThanOrEqual(grassKeep(d));
      expect(grassKeep(d) - grassKeep(d + 0.5)).toBeLessThan(0.02);
    }
  });
});
