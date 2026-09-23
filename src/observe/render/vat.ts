import {
  AnimationMixer,
  BufferAttribute,
  BufferGeometry,
  DataTexture,
  FloatType,
  InstancedBufferAttribute,
  InstancedMesh,
  NearestFilter,
  RGBAFormat,
  Vector3,
  type AnimationClip,
  type Material,
  type Object3D,
  type SkinnedMesh,
} from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';

/**
 * 頂点アニメをテクスチャに焼いた群れ (VAT、設計 §8)。SkinnedMesh を 1 頭ずつ描くと draw call が頭数 × 材質数になるので、
 * 群れの LOD は全フレームの頂点位置と法線をテクスチャに焼き、1 つの InstancedMesh で描く (個体ごとにクリップと位相を持つ)。
 */
export const VAT_FPS = 15;

export type VatClip = { name: string; start: number; frames: number };
export type VatBake = { geometry: BufferGeometry; posTex: DataTexture; nrmTex: DataTexture; clips: VatClip[]; vertexCount: number; frameCount: number };

/** root (glTF の scene を複製したもの) の中の skinnedName を、clips の各クリップで VAT_FPS ごとに姿勢を取って焼く */
export function bakeVat(source: Object3D, skinnedName: string, clips: AnimationClip[]): VatBake | null {
  const root = cloneSkinned(source);
  const skinned = root.getObjectByName(skinnedName) as SkinnedMesh | undefined;
  if (!skinned || !(skinned as SkinnedMesh).isSkinnedMesh) return null;
  return bakeSkinned(root, skinned, clips);
}

/**
 * 材質が複数あるメッシュは glTF で「名前のグループ + 材質ごとの SkinnedMesh の子」になる (月鹿の群れ LOD は 5 材質)。
 * 子ごとに焼いて、材質ごとの VAT を返す
 */
export function bakeVatAll(source: Object3D, nodeName: string, clips: AnimationClip[]): { bake: VatBake; material: Material | Material[] }[] {
  const root = cloneSkinned(source);
  const node = root.getObjectByName(nodeName);
  if (!node) return [];
  const out: { bake: VatBake; material: Material | Material[] }[] = [];
  node.traverse((o) => {
    const sk = o as SkinnedMesh;
    if (!sk.isSkinnedMesh) return;
    const bake = bakeSkinned(root, sk, clips);
    out.push({ bake, material: sk.material });
  });
  return out;
}

function bakeSkinned(root: Object3D, skinned: SkinnedMesh, clips: AnimationClip[]): VatBake {
  const mixer = new AnimationMixer(root);
  const vcount = skinned.geometry.getAttribute('position').count;
  const plan: VatClip[] = [];
  let frameCount = 0;
  for (const c of clips) {
    const frames = Math.max(1, Math.round(c.duration * VAT_FPS));
    plan.push({ name: c.name, start: frameCount, frames });
    frameCount += frames;
  }
  const pos = new Float32Array(vcount * frameCount * 4);
  const nrm = new Float32Array(vcount * frameCount * 4);
  const tmp = new BufferGeometry();
  const tmpPos = new Float32Array(vcount * 3);
  tmp.setAttribute('position', new BufferAttribute(tmpPos, 3));
  if (skinned.geometry.index) tmp.setIndex(skinned.geometry.index.clone());
  const v = new Vector3();
  for (let ci = 0; ci < clips.length; ci++) {
    mixer.stopAllAction();
    const action = mixer.clipAction(clips[ci]);
    action.play();
    for (let f = 0; f < plan[ci].frames; f++) {
      mixer.setTime(f / VAT_FPS);
      root.updateMatrixWorld(true);
      skinned.skeleton.update();
      for (let i = 0; i < vcount; i++) {
        // getVertexPosition はメッシュのローカル座標なので、Blender 由来のアーマチュアの拡大・回転を含めて root の座標に直す
        skinned.getVertexPosition(i, v).applyMatrix4(skinned.matrixWorld);
        tmpPos[i * 3] = v.x;
        tmpPos[i * 3 + 1] = v.y;
        tmpPos[i * 3 + 2] = v.z;
      }
      tmp.getAttribute('position').needsUpdate = true;
      tmp.computeVertexNormals();
      const n = tmp.getAttribute('normal');
      const row = (plan[ci].start + f) * vcount * 4;
      for (let i = 0; i < vcount; i++) {
        pos.set([tmpPos[i * 3], tmpPos[i * 3 + 1], tmpPos[i * 3 + 2], 1], row + i * 4);
        nrm.set([n.getX(i), n.getY(i), n.getZ(i), 0], row + i * 4);
      }
    }
  }
  const mk = (data: Float32Array) => {
    const t = new DataTexture(data, vcount, frameCount, RGBAFormat, FloatType);
    t.minFilter = NearestFilter;
    t.magFilter = NearestFilter;
    t.needsUpdate = true;
    return t;
  };
  const geometry = skinned.geometry.clone();
  geometry.deleteAttribute('skinIndex');
  geometry.deleteAttribute('skinWeight');
  const vid = new Float32Array(vcount);
  for (let i = 0; i < vcount; i++) vid[i] = i;
  geometry.setAttribute('aVid', new BufferAttribute(vid, 1));
  return { geometry, posTex: mk(pos), nrmTex: mk(nrm), clips: plan, vertexCount: vcount, frameCount };
}

export type VatHerd = {
  mesh: InstancedMesh;
  /** 個体 i のクリップと位相 (秒) を設定する */
  setClip(i: number, clip: string, phase: number): void;
  update(t: number): void;
};

/** 焼いた VAT を材質に差し込み、max 頭の InstancedMesh にする。材質は複製してから onBeforeCompile を足す */
export function createVatHerd(bake: VatBake, materials: Material | Material[], max: number): VatHerd {
  const uniforms = { uTime: { value: 0 }, uPos: { value: bake.posTex }, uNrm: { value: bake.nrmTex } };
  const clipAttr = new InstancedBufferAttribute(new Float32Array(max * 3), 3);
  bake.geometry.setAttribute('aClip', clipAttr);
  const patch = (m: Material): Material => {
    const c = m.clone();
    const base = m.onBeforeCompile;
    c.onBeforeCompile = (shader, renderer) => {
      base.call(c, shader, renderer);
      shader.uniforms.uTime = uniforms.uTime;
      shader.uniforms.uVatPos = uniforms.uPos;
      shader.uniforms.uVatNrm = uniforms.uNrm;
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          [
            '#include <common>',
            'uniform float uTime;',
            'uniform sampler2D uVatPos;',
            'uniform sampler2D uVatNrm;',
            'attribute float aVid;',
            'attribute vec3 aClip;',
            `ivec2 vatUv() { float f = aClip.x + mod(floor((uTime + aClip.z) * ${VAT_FPS.toFixed(1)}), aClip.y); return ivec2(int(aVid), int(f)); }`,
          ].join('\n'),
        )
        .replace('#include <beginnormal_vertex>', 'vec3 objectNormal = texelFetch(uVatNrm, vatUv(), 0).xyz;')
        .replace('#include <begin_vertex>', 'vec3 transformed = texelFetch(uVatPos, vatUv(), 0).xyz;');
    };
    c.customProgramCacheKey = () => `vat-${m.uuid}`;
    return c;
  };
  const mats = Array.isArray(materials) ? materials.map(patch) : patch(materials);
  const mesh = new InstancedMesh(bake.geometry, mats, max);
  mesh.frustumCulled = false;
  mesh.castShadow = true;
  const byName = new Map(bake.clips.map((c) => [c.name, c]));
  return {
    mesh,
    setClip(i, clip, phase) {
      const c = byName.get(clip) ?? bake.clips[0];
      clipAttr.setXYZ(i, c.start, c.frames, phase);
      clipAttr.needsUpdate = true;
    },
    update(t) {
      uniforms.uTime.value = t;
    },
  };
}
