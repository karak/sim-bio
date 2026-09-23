import { describe, it, expect } from 'vitest';
import { BoxGeometry, Color, DoubleSide, Group, Mesh, type BufferAttribute } from 'three';
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
