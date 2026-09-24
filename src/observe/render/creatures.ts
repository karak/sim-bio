import {
  AnimationMixer,
  BufferGeometry,
  CapsuleGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  Quaternion,
  Vector3,
  type AnimationClip,
  type Camera,
  type Object3D,
  type SkinnedMesh,
} from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import type { Agent, AgentSpecies, AgentState } from '../agents';
import { RETURN_S } from '../agents';
import { bakeVatAll, createVatHerd, type VatHerd } from './vat';
import { createToonMaterial } from './toon';
import { ViewCull } from './cull';

/**
 * 個体層 (src/observe/agents.ts) の個体を描く (設計 §8)。
 * 月鹿はカメラに近い NEAR 頭だけ SkinnedMesh (lod0、約 3,000 三角形)、残りは VAT の InstancedMesh (lod1、約 900 三角形)。
 * どの個体を近くで描くかは 0.25 秒ごとに振り分け直す。狼と兎はモデルができるまで仮の形で描く。
 * (M22-05: 狼・兎も同じ作りにした。種ごとの違いは RIGS の表 (ノード名・近くで描く頭数・状態 → クリップ) に置く。
 * GLB が無い種だけ仮の形で描く)
 */
const NEAR = 12;

/** 状態 → アニメのクリップ。倒れた個体は fall を 1 回流し、あとは最後の姿勢で止める (fallHold) */
export function clipFor(state: AgentState, t: number): string {
  switch (state) {
    case 'walk':
    case 'enter':
    case 'leave':
    case 'carry':
    case 'stalk':
      return 'walk';
    case 'flee':
    case 'chase':
      return 'run';
    case 'graze':
      return 'graze';
    case 'fall':
      return t < 2 ? 'fall' : 'fallHold';
    case 'return':
      return 'fallHold';
    default:
      return 'idle';
  }
}

/** 狼に飛びかかりを見せる、獲物までの距離 (m) */
const POUNCE_M = 3;

/** 灰狼: 忍び寄りは stalk、追う途中で獲物に POUNCE_M まで迫ったら pounce。他は月鹿と同じ */
export function wolfClip(a: Agent, find: (id: number) => Agent | undefined): string {
  if (a.state === 'stalk') return 'stalk';
  if (a.state === 'chase' && a.target && 'agent' in a.target) {
    const prey = find(a.target.agent);
    if (prey && Math.hypot(prey.x - a.x, prey.z - a.z) < POUNCE_M) return 'pounce';
  }
  return clipFor(a.state, a.t);
}

/** 土兎: 歩く代わりに跳ねる (hop)。立ち止まった個体の 3 頭に 1 頭は耳を立てて見張る (alert) */
export function rabbitClip(a: Agent): string {
  const c = clipFor(a.state, a.t);
  if (c === 'walk') return 'hop';
  if (c === 'idle' && a.id % 3 === 0) return 'alert';
  return c;
}

type SpeciesRig = {
  /** lod0 の見た目の違い (雄・雌など)。同じ骨に重なって入っていて、個体ごとに 1 つだけ見せる */
  lod0: readonly string[];
  lod1: string;
  /** カメラに近い何頭を SkinnedMesh で描くか (draw call は 頭数 × 材質 × 影 で増える) */
  near: number;
  clip(a: Agent, find: (id: number) => Agent | undefined): string;
  variant(a: Agent): number;
  placeholder: { color: string; radius: number; length: number };
  /**
   * (M23-04) 群れ LOD (lod1) は雄の形しか無いので、影を群れ LOD で落とすとき、見た目の違い variant の個体は
   * 骨 bone に結ばれた光る頂点 (焼いた aEmissive) のうち高さ aboveY より上を含む三角形を除いた形で落とす (雌の影に雄の光る角が出ない)
   */
  shadowTrim?: { variant: number; bone: string; aboveY: number };
};

export const RIGS: Record<AgentSpecies, SpeciesRig> = {
  deer: {
    lod0: ['deer', 'deer_doe'],
    lod1: 'deer_lod1',
    near: NEAR,
    clip: (a) => clipFor(a.state, a.t),
    variant: (a) => (a.id % 2 === 0 ? 1 : 0),
    placeholder: { color: '#D2A04E', radius: 0.35, length: 1.0 },
    // (M23-04) 雌 (deer_doe) の光る模様は 1.88 m まで、雄の角は頭の骨で 2.9 m まで
    shadowTrim: { variant: 1, bone: 'head', aboveY: 1.95 },
  },
  wolf: { lod0: ['wolf'], lod1: 'wolf_lod1', near: 4, clip: wolfClip, variant: () => 0, placeholder: { color: '#E07A55', radius: 0.3, length: 0.9 } },
  rabbit: { lod0: ['rabbit'], lod1: 'rabbit_lod1', near: 6, clip: rabbitClip, variant: () => 0, placeholder: { color: '#D6B85E', radius: 0.16, length: 0.25 } },
};

/**
 * (M23-04) 骨入りの形 geo から、骨 bone に結ばれた光る頂点 (焼いた aEmissive が 0 より大きい) で高さ (結んだ姿勢の y) が aboveY より上の頂点を
 * 1 つでも含む三角形を除いた形を返す。属性は元と共有し、index だけ作り直す
 */
export function trimGlow(geo: BufferGeometry, bone: number, aboveY: number): BufferGeometry {
  const pos = geo.getAttribute('position');
  const em = geo.getAttribute('aEmissive');
  const si = geo.getAttribute('skinIndex');
  const sw = geo.getAttribute('skinWeight');
  if (!em || !si || !sw) return geo;
  const drop = (i: number) => {
    if (pos.getY(i) <= aboveY || em.getX(i) + em.getY(i) + em.getZ(i) <= 0) return false;
    for (let k = 0; k < 4; k++) if (si.getComponent(i, k) === bone && sw.getComponent(i, k) > 0) return true;
    return false;
  };
  const n = geo.index ? geo.index.count : pos.count;
  const at = (k: number) => (geo.index ? geo.index.getX(k) : k);
  const keep: number[] = [];
  for (let k = 0; k + 2 < n; k += 3) {
    const a = at(k);
    const b = at(k + 1);
    const c = at(k + 2);
    if (!drop(a) && !drop(b) && !drop(c)) keep.push(a, b, c);
  }
  const out = new BufferGeometry();
  for (const [name, attr] of Object.entries(geo.attributes)) out.setAttribute(name, attr);
  out.setIndex(keep);
  out.boundingSphere = geo.boundingSphere;
  out.boundingBox = geo.boundingBox;
  return out;
}

/** 還る個体は RETURN_S かけて地面に沈み、小さくなる (生気の光の粒は M22-07 の演出で足す) */
function sinkOf(a: Agent): number {
  return a.state === 'return' ? Math.min(1, a.t / RETURN_S) : 0;
}

type Placeholder = { mesh: InstancedMesh };

export type CreatureView = { group: Group; update(agents: readonly Agent[], camera: { position: Vector3 }, heightAt: (x: number, z: number) => number, t: number, dt: number): void };

type SpeciesView = {
  update(own: readonly Agent[], find: (id: number) => Agent | undefined, camera: { position: Vector3 }, heightAt: (x: number, z: number) => number, t: number, dt: number): void;
};

/**
 * (M23-04) shadowOnly を渡すと、近くの骨入りの個体の影は群れ LOD (lod1、月鹿 866 三角形) の骨入りで落とす (lod0 は castShadow = false)。
 * 群れ LOD は同じ骨に結ばれているので、影は本の描画の姿勢と同じに動く (render/shadowOnly.ts が影の描画の前に骨を更新する)
 */
export function createCreatureView(glbs: Partial<Record<AgentSpecies, GLTF | null>>, maxPerSpecies: number, shadowOnly?: (root: Object3D) => void): CreatureView {
  const group = new Group();
  const species = Object.keys(RIGS) as AgentSpecies[];
  const views = new Map(species.map((sp) => [sp, createSpeciesView(group, sp, glbs[sp] ?? null, maxPerSpecies, shadowOnly)]));
  return {
    group,
    update(agents, camera, heightAt, t, dt) {
      const byId = new Map(agents.map((a) => [a.id, a]));
      const find = (id: number) => byId.get(id);
      for (const sp of species) {
        const own = agents.filter((a) => a.species === sp && a.state !== 'board');
        views.get(sp)!.update(own, find, camera, heightAt, t, dt);
      }
    },
  };
}

function createSpeciesView(group: Group, sp: AgentSpecies, glb: GLTF | null, maxPerSpecies: number, shadowOnly?: (root: Object3D) => void): SpeciesView {
  const rig = RIGS[sp];
  const clips: AnimationClip[] = glb?.animations ?? [];
  // 群れ LOD は材質ごとの子に分かれているので、子ごとに VAT の群れを作り、同じ行列・クリップで動かす
  const bakes = glb && clips.length ? bakeVatAll(glb.scene, rig.lod1, clips) : [];
  const herds: VatHerd[] = bakes.map(({ bake, material }) => {
    // 倒れたあとの姿勢 = fall の最後の 1 フレームを、ループしない 1 フレームのクリップとして足す
    const fall = bake.clips.find((c) => c.name === 'fall');
    if (fall) bake.clips.push({ name: 'fallHold', start: fall.start + fall.frames - 1, frames: 1 });
    const h = createVatHerd(bake, material, maxPerSpecies);
    h.mesh.count = 0;
    // 影の描画は VAT を知らない (束ねた姿勢のまま影が落ちる) ので、遠い群れは影を落とさない
    h.mesh.castShadow = false;
    group.add(h.mesh);
    return h;
  });
  const herd = herds.length > 0;
  // (M23-02) 群れ (VAT) は丸ごとの判定を切ってある (frustumCulled = false) ので、視錐台で見える個体だけを書く
  const herdR = Math.max(0, ...bakes.map((b) => b.bake.radius));
  const view = new ViewCull();
  // (M23-04 で変更: shadow は影を落とす群れ LOD の骨入り、trimmed は shadowTrim の個体に使う形)
  type NearSlot = { obj: Object3D; variants: (Object3D | null)[]; mixer: AnimationMixer; agent: number; clip: string; shadow: { mesh: SkinnedMesh; full: BufferGeometry; trimmed: BufferGeometry }[] };
  const pool: NearSlot[] = [];
  const trimmedCache = new Map<BufferGeometry, BufferGeometry>();
  if (glb && clips.length) {
    for (let i = 0; i < rig.near; i++) {
      const obj = cloneSkinned(glb.scene);
      const l = obj.getObjectByName(rig.lod1);
      if (l) l.visible = false;
      // (M23-04) 影は群れ LOD で落とす
      if (l && shadowOnly) {
        obj.traverse((o) => (o.castShadow = false));
        shadowOnly(l);
      }
      obj.visible = false;
      group.add(obj);
      // GLB には雄 (deer) と雌 (deer_doe) が同じ骨で重なって入っている。個体ごとにどちらか一方だけ見せる
      const shadow: NearSlot['shadow'] = [];
      if (l && shadowOnly && rig.shadowTrim) {
        const trim = rig.shadowTrim;
        l.traverse((o) => {
          const sk = o as SkinnedMesh;
          if (!sk.isSkinnedMesh) return;
          const head = sk.skeleton.bones.findIndex((b) => b.name === trim.bone);
          let trimmed = trimmedCache.get(sk.geometry);
          if (!trimmed) trimmedCache.set(sk.geometry, (trimmed = head < 0 ? sk.geometry : trimGlow(sk.geometry, head, trim.aboveY)));
          shadow.push({ mesh: sk, full: sk.geometry, trimmed });
        });
      }
      pool.push({ obj, variants: rig.lod0.map((n) => obj.getObjectByName(n) ?? null), mixer: new AnimationMixer(obj), agent: -1, clip: '', shadow });
    }
  }
  let placeholder: Placeholder | null = null;
  if (!herd) {
    const { color, radius, length } = rig.placeholder;
    const mesh = new InstancedMesh(new CapsuleGeometry(radius, length, 3, 6), createToonMaterial({ color }), maxPerSpecies);
    mesh.count = 0;
    mesh.castShadow = true;
    mesh.frustumCulled = false;
    group.add(mesh);
    placeholder = { mesh };
  }
  const herdClip = new Map<number, string>();
  const m = new Matrix4();
  const q = new Quaternion();
  const up = new Vector3(0, 1, 0);
  const side = new Vector3(0, 0, 1);
  const p = new Vector3();
  const s = new Vector3();
  let nearIds = new Set<number>();
  let lastAssign = -1;
  let clock = 0;
  const findClip = (name: string) => clips.find((c) => c.name === name) ?? clips.find((c) => c.name === 'idle');
  return {
    update(own, find, camera, heightAt, t, dt) {
      clock += dt;
      // 近くで描く個体の振り分け (0.25 秒ごと)
      if (pool.length && clock - lastAssign > 0.25) {
        lastAssign = clock;
        const byDist = [...own].sort((a, b) => Math.hypot(a.x - camera.position.x, a.z - camera.position.z) - Math.hypot(b.x - camera.position.x, b.z - camera.position.z));
        nearIds = new Set(byDist.slice(0, pool.length).map((a) => a.id));
        const free = pool.filter((sl) => !nearIds.has(sl.agent));
        const held = new Set(pool.filter((sl) => nearIds.has(sl.agent)).map((sl) => sl.agent));
        for (const id of nearIds) {
          if (held.has(id)) continue;
          const sl = free.pop();
          if (!sl) break;
          sl.agent = id;
          sl.clip = '';
        }
        for (const sl of free) {
          sl.agent = -1;
          sl.obj.visible = false;
        }
      }
      for (const sl of pool) {
        const a = sl.agent >= 0 ? find(sl.agent) : undefined;
        if (!a || a.state === 'board') {
          sl.obj.visible = false;
          continue;
        }
        const clip = rig.clip(a, find);
        if (clip !== sl.clip) {
          sl.clip = clip;
          sl.mixer.stopAllAction();
          const c = findClip(clip === 'fallHold' ? 'fall' : clip);
          if (c) {
            const act = sl.mixer.clipAction(c);
            act.reset();
            if (clip === 'fall' || clip === 'fallHold') {
              act.setLoop(2200, 1);
              act.clampWhenFinished = true;
              if (clip === 'fallHold') act.time = c.duration;
            }
            act.play();
          }
        }
        sl.mixer.update(dt);
        const sink = sinkOf(a);
        sl.obj.visible = true;
        // 雌は偶数の id (群れ LOD は雄しか無いので、遠くでは雄に見える。M22-05 で雌の群れ LOD を足す)
        const v = rig.variant(a);
        sl.variants.forEach((o, i) => o && (o.visible = i === v));
        for (const sh of sl.shadow) sh.mesh.geometry = v === rig.shadowTrim?.variant ? sh.trimmed : sh.full;
        sl.obj.position.set(a.x, heightAt(a.x, a.z) - sink * 0.8, a.z);
        sl.obj.rotation.y = a.heading;
        sl.obj.scale.setScalar(1 - sink * 0.4);
      }
      if (herd) {
        let k = 0;
        const eye = (camera as unknown as Camera).isCamera ? (camera as unknown as Camera) : null;
        if (eye) view.update(eye);
        for (const a of own) {
          if (nearIds.has(a.id) && pool.length) continue;
          if (eye && !view.sees(a.x, heightAt(a.x, a.z), a.z, herdR)) continue;
          const clip = rig.clip(a, find);
          if (herdClip.get(a.id) !== clip || herdClip.get(-1 - k) !== String(a.id)) {
            // fall は倒れた瞬間 (t − a.t) にフレーム 0 になるよう位相を合わせる (VAT はループするので、2 秒で fallHold に移る前提)
            // (月鹿の graze が 10 s になったので、位相は 0〜10 s に散らす)
            for (const h of herds) h.setClip(k, clip, clip === 'fall' ? a.t - t : (a.id * 0.37) % 10);
            herdClip.set(a.id, clip);
            herdClip.set(-1 - k, String(a.id));
          }
          const sink = sinkOf(a);
          q.setFromAxisAngle(up, a.heading);
          s.setScalar(1 - sink * 0.4);
          m.compose(p.set(a.x, heightAt(a.x, a.z) - sink * 0.8, a.z), q, s);
          for (const h of herds) h.mesh.setMatrixAt(k, m);
          k++;
        }
        for (const h of herds) {
          h.mesh.count = k;
          h.mesh.instanceMatrix.needsUpdate = true;
          h.update(t);
        }
      }
      if (placeholder) {
        let k = 0;
        const r = rig.placeholder.radius;
        for (const a of own) {
          if (nearIds.has(a.id) && pool.length) continue;
          const lying = a.state === 'fall' || a.state === 'return';
          const sink = sinkOf(a);
          // カプセルは縦 (Y) なので、X 軸まわりに 90° 倒して体の向き (+Z) に寝かせる。倒れた個体はさらに横倒し
          q.setFromAxisAngle(up, a.heading).multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI / 2));
          if (lying) q.multiply(new Quaternion().setFromAxisAngle(side, Math.PI / 2));
          s.setScalar(1 - sink * 0.5);
          placeholder.mesh.setMatrixAt(k, m.compose(p.set(a.x, heightAt(a.x, a.z) + (lying ? r : r * 2.6) - sink, a.z), q, s));
          k++;
        }
        placeholder.mesh.count = k;
        placeholder.mesh.instanceMatrix.needsUpdate = true;
      }
    },
  };
}
