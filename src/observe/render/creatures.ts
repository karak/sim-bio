import {
  AnimationMixer,
  CapsuleGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  Quaternion,
  Vector3,
  type AnimationClip,
  type Object3D,
} from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import type { Agent, AgentSpecies, AgentState } from '../agents';
import { RETURN_S } from '../agents';
import { bakeVatAll, createVatHerd, type VatHerd } from './vat';
import { createToonMaterial } from './toon';

/**
 * 個体層 (src/observe/agents.ts) の個体を描く (設計 §8)。
 * 月鹿はカメラに近い NEAR 頭だけ SkinnedMesh (lod0、約 3,000 三角形)、残りは VAT の InstancedMesh (lod1、約 900 三角形)。
 * どの個体を近くで描くかは 0.25 秒ごとに振り分け直す。狼と兎はモデルができるまで仮の形で描く。
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

/** 還る個体は RETURN_S かけて地面に沈み、小さくなる (生気の光の粒は M22-07 の演出で足す) */
function sinkOf(a: Agent): number {
  return a.state === 'return' ? Math.min(1, a.t / RETURN_S) : 0;
}

type Placeholder = { mesh: InstancedMesh };

export type CreatureView = { group: Group; update(agents: readonly Agent[], camera: { position: Vector3 }, heightAt: (x: number, z: number) => number, t: number, dt: number): void };

export function createCreatureView(deerGlb: GLTF | null, maxPerSpecies: number): CreatureView {
  const group = new Group();
  const clips: AnimationClip[] = deerGlb?.animations ?? [];
  // 群れ LOD は材質ごとの子に分かれているので、子ごとに VAT の群れを作り、同じ行列・クリップで動かす
  const bakes = deerGlb && clips.length ? bakeVatAll(deerGlb.scene, 'deer_lod1', clips) : [];
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
  type NearSlot = { obj: Object3D; stag: Object3D | null; doe: Object3D | null; mixer: AnimationMixer; agent: number; clip: string };
  const pool: NearSlot[] = [];
  if (deerGlb && clips.length) {
    for (let i = 0; i < NEAR; i++) {
      const obj = cloneSkinned(deerGlb.scene);
      const l = obj.getObjectByName('deer_lod1');
      if (l) l.visible = false;
      obj.visible = false;
      group.add(obj);
      // GLB には雄 (deer) と雌 (deer_doe) が同じ骨で重なって入っている。個体ごとにどちらか一方だけ見せる
      pool.push({ obj, stag: obj.getObjectByName('deer') ?? null, doe: obj.getObjectByName('deer_doe') ?? null, mixer: new AnimationMixer(obj), agent: -1, clip: '' });
    }
  }
  const placeholders: Partial<Record<AgentSpecies, Placeholder>> = {};
  const colors: Record<AgentSpecies, string> = { deer: '#D2A04E', wolf: '#E07A55', rabbit: '#D6B85E' };
  const sizes: Record<AgentSpecies, [number, number]> = { deer: [0.35, 1.0], wolf: [0.3, 0.9], rabbit: [0.16, 0.25] };
  for (const sp of ['deer', 'wolf', 'rabbit'] as AgentSpecies[]) {
    if (sp === 'deer' && herd) continue;
    const [r, l] = sizes[sp];
    const mesh = new InstancedMesh(new CapsuleGeometry(r, l, 3, 6), createToonMaterial({ color: colors[sp] }), maxPerSpecies);
    mesh.count = 0;
    mesh.castShadow = true;
    mesh.frustumCulled = false;
    group.add(mesh);
    placeholders[sp] = { mesh };
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
  const findClip = (name: string) => clips.find((c) => c.name === name);
  return {
    group,
    update(agents, camera, heightAt, t, dt) {
      clock += dt;
      const deer = agents.filter((a) => a.species === 'deer' && a.state !== 'board');
      // 近くで描く個体の振り分け (0.25 秒ごと)
      if (pool.length && clock - lastAssign > 0.25) {
        lastAssign = clock;
        const byDist = [...deer].sort((a, b) => Math.hypot(a.x - camera.position.x, a.z - camera.position.z) - Math.hypot(b.x - camera.position.x, b.z - camera.position.z));
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
      const byId = new Map(agents.map((a) => [a.id, a]));
      for (const sl of pool) {
        const a = sl.agent >= 0 ? byId.get(sl.agent) : undefined;
        if (!a || a.state === 'board') {
          sl.obj.visible = false;
          continue;
        }
        const clip = clipFor(a.state, a.t);
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
        const isDoe = !!sl.doe && a.id % 2 === 0;
        if (sl.stag) sl.stag.visible = !isDoe;
        if (sl.doe) sl.doe.visible = isDoe;
        sl.obj.position.set(a.x, heightAt(a.x, a.z) - sink * 0.8, a.z);
        sl.obj.rotation.y = a.heading;
        sl.obj.scale.setScalar(1 - sink * 0.4);
      }
      if (herd) {
        let k = 0;
        for (const a of deer) {
          if (nearIds.has(a.id) && pool.length) continue;
          const clip = clipFor(a.state, a.t);
          if (herdClip.get(a.id) !== clip || herdClip.get(-1 - k) !== String(a.id)) {
            // fall は倒れた瞬間 (t − a.t) にフレーム 0 になるよう位相を合わせる (VAT はループするので、2 秒で fallHold に移る前提)
            for (const h of herds) h.setClip(k, clip, clip === 'fall' ? a.t - t : (a.id * 0.37) % 5);
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
      for (const sp of ['deer', 'wolf', 'rabbit'] as AgentSpecies[]) {
        const ph = placeholders[sp];
        if (!ph) continue;
        let k = 0;
        const r = sizes[sp][0];
        for (const a of agents) {
          if (a.species !== sp || a.state === 'board') continue;
          if (sp === 'deer' && nearIds.has(a.id) && pool.length) continue;
          const lying = a.state === 'fall' || a.state === 'return';
          const sink = sinkOf(a);
          // カプセルは縦 (Y) なので、X 軸まわりに 90° 倒して体の向き (+Z) に寝かせる。倒れた個体はさらに横倒し
          q.setFromAxisAngle(up, a.heading).multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI / 2));
          if (lying) q.multiply(new Quaternion().setFromAxisAngle(side, Math.PI / 2));
          s.setScalar(1 - sink * 0.5);
          ph.mesh.setMatrixAt(k, m.compose(p.set(a.x, heightAt(a.x, a.z) + (lying ? r : r * 2.6) - sink, a.z), q, s));
          k++;
        }
        ph.mesh.count = k;
        ph.mesh.instanceMatrix.needsUpdate = true;
      }
    },
  };
}
