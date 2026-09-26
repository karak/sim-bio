import { describe, it, expect } from 'vitest';
import {
  BoxGeometry,
  DataTexture,
  DoubleSide,
  Group,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  Raycaster,
  ShaderChunk,
  Vector3,
  type InstancedMesh,
  type MeshDepthMaterial,
  type MeshToonMaterial,
  type WebGLProgramParametersWithUniforms,
  type WebGLRenderer,
} from 'three';
import { createFoliageMaterial } from '../../src/observe/render/foliage';
import { toToon } from '../../src/observe/render/assets';
import { bakeMaterials } from '../../src/observe/render/bake';
import { instanceProps } from '../../src/observe/render/instancer';
import { createToonMaterial } from '../../src/observe/render/toon';

const leafTexture = () => new DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);

/** 木のノード: 焼ける塊 (平らな色) と、絵のアルファで切り抜く葉のカード (glTF の alphaMode MASK を読んだ形) */
function treeNode(): { root: Group; node: Group; card: Mesh } {
  const root = new Group();
  const node = new Group();
  node.name = 'belltree_mature';
  root.add(node);
  const lump = new Mesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial({ color: '#86A044' }));
  const card = new Mesh(
    new PlaneGeometry(2, 2),
    new MeshStandardMaterial({ name: 'belltree_foliage', map: leafTexture(), alphaTest: 0.5, side: DoubleSide, vertexColors: true }),
  );
  node.add(lump, card);
  return { root, node, card };
}

describe('観察画面 (木の磨き上げ): 葉のカードの材質', () => {
  it('絵のアルファで切り抜く両面のトゥーン。alphaToCoverage は使わず、縁の光は弱い', () => {
    const map = leafTexture();
    const m = createFoliageMaterial(map, 0.5, 'belltree_foliage');
    expect(m.map).toBe(map);
    expect(m.alphaTest).toBe(0.5);
    expect(m.side).toBe(DoubleSide);
    expect(m.vertexColors).toBe(true);
    // 縁の画素のアルファが画面まで届いてキャンバスの後ろが透けるので、alphaToCoverage は切る
    expect(m.alphaToCoverage).toBe(false);
    expect(m.name).toBe('belltree_foliage');
  });

  it('裏から見ても法線を裏返さない。シェーダの作りが違うので、トゥーンとはプログラムの鍵を分ける', () => {
    const m = createFoliageMaterial(leafTexture(), 0.5);
    const shader = {
      uniforms: {},
      vertexShader: '#include <common>\nvoid main() {}',
      fragmentShader: '#include <common>\nvoid main() {\n#include <normal_fragment_begin>\n#include <dithering_fragment>\n}',
    } as unknown as WebGLProgramParametersWithUniforms;
    m.onBeforeCompile(shader, {} as WebGLRenderer);
    expect(ShaderChunk.normal_fragment_begin).toContain('normal *= faceDirection;');
    expect(shader.fragmentShader).not.toContain('#include <normal_fragment_begin>');
    expect(shader.fragmentShader).not.toContain('normal *= faceDirection;');
    expect(shader.fragmentShader).toContain('float faceDirection = gl_FrontFacing ? 1.0 : - 1.0;');
    // トゥーンの縁の光は残る (uRim は 0.06)
    expect(shader.fragmentShader).toContain('uRimColor * uRimLight * rimTerm * uRim');
    expect((shader.uniforms as Record<string, { value: unknown }>).uRim.value).toBe(0.06);
    const toonKey = createToonMaterial({ rim: 0.06 }).customProgramCacheKey();
    expect(m.customProgramCacheKey()).toBe(`foliage-${toonKey}`);
  });

  it('GLB を読んだ後: カードは葉のカードの材質になり、切り抜いた影の材質と当たり判定から外す印を持つ。焼きには混ざらない', () => {
    const { root, node, card } = treeNode();
    toToon(root);
    bakeMaterials(root);
    const mat = card.material as MeshToonMaterial;
    expect(mat.customProgramCacheKey()).toMatch(/^foliage-/);
    expect(mat.alphaTest).toBe(0.5);
    const depth = card.customDepthMaterial as MeshDepthMaterial;
    expect(depth.map).toBe(mat.map);
    expect(depth.alphaTest).toBe(0.5);
    expect(depth.side).toBe(DoubleSide);
    expect(card.userData.foliage).toBe(true);
    // 塊は焼けて 1 つに (1 つしか無いのでその場で焼く)、カードは絵つきなので焼かずに残る
    expect(node.children.length).toBe(2);
    expect(node.children).toContain(card);
    const lump = node.children.find((c) => c !== card) as Mesh;
    expect(lump.userData.foliage).toBeUndefined();
    expect(lump.customDepthMaterial).toBeUndefined();
  });

  it('インスタンス化しても切り抜いた影の材質を引き継ぎ、カードは光線に当たらない (塊は当たる)', () => {
    const { root, node, card } = treeNode();
    toToon(root);
    bakeMaterials(root);
    const g = instanceProps(node, [new Matrix4()]);
    const insts = g.children as InstancedMesh[];
    expect(insts.length).toBe(2);
    const cardInst = insts.find((i) => i.material === card.material)!;
    const lumpInst = insts.find((i) => i !== cardInst)!;
    expect(cardInst.customDepthMaterial).toBe(card.customDepthMaterial);
    expect(lumpInst.customDepthMaterial).toBeUndefined();
    g.updateMatrixWorld(true);
    // カード (2 × 2 の板、z = 0) と塊 (1 × 1 × 1 の箱) を正面から射抜く光線: 当たるのは塊だけ
    const hits = new Raycaster(new Vector3(0, 0, 5), new Vector3(0, 0, -1)).intersectObjects(g.children, false);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((h) => h.object === lumpInst)).toBe(true);
  });
});
