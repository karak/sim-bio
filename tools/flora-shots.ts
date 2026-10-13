#!/usr/bin/env node
/**
 * 草木の寄りの画を撮る台 (M22-11)。観察画面 (observe.html) を開き、鐘樹の株・成木・森の木の幹へ決まったカメラで寄って PNG を書く。
 * 丸太 (belltree_logs) は観察画面に置かれていないので、株の隣に GLB のノードを足して撮る (印の「足した丸太」を画に書く)。
 * 前後の比較画は、同じ台を変更の前と後のコミットで走らせて並べる。
 *
 * 使い方:
 *   node tools/flora-shots.ts --url http://127.0.0.1:5611 --out <dir> [--prefix before-]
 *   その他: --list (場面の InstancedMesh の一覧を出すだけ)、--headed
 */
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium, type Page } from '@playwright/test';

const VIEWPORT = { width: 1280, height: 720 };
const HIDE_DEV_UI = '#stats, #shots, #status { display: none !important; }';

type Cam = { pos: [number, number, number]; target: [number, number, number] };
type Placed = { kind: 'stump' | 'mature' | 'forest'; x: number; y: number; z: number };

const arg = (name: string, fallback?: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
};

/** 場面の InstancedMesh を、形の大きさ (幅・高さ) と三角形の数で株・成木・森の木に分け、置き場所を読む */
async function findPlaced(page: Page): Promise<Placed[]> {
  return page.evaluate(() => {
    type V = { x: number; y: number; z: number };
    type IM = {
      isInstancedMesh?: boolean;
      count: number;
      geometry: { index: { count: number } | null; attributes: { position: { count: number } }; boundingBox: { min: V; max: V } | null; computeBoundingBox(): void };
      getMatrixAt(i: number, m: unknown): void;
      visible: boolean;
    };
    const air = (window as unknown as { __probe: { observe: { air: { scene: { traverse(f: (o: IM) => void): void }; camera: { position: V & { constructor: new () => V & { setFromMatrixPosition(m: unknown): V } } } } } } }).__probe.observe.air;
    const out: Placed[] = [];
    const seen = new Set<string>();
    const Vec = air.camera.position.constructor;
    air.scene.traverse((o) => {
      if (!o.isInstancedMesh || o.count === 0) return;
      const g = o.geometry;
      if (!g.boundingBox) g.computeBoundingBox();
      const b = g.boundingBox!;
      const w = Math.max(b.max.x - b.min.x, b.max.z - b.min.z);
      const h = b.max.y - b.min.y;
      const tris = (g.index ? g.index.count : g.attributes.position.count) / 3;
      let kind: Placed['kind'] | null = null;
      if (h > 0.7 && h < 1.3 && w > 1.8 && w < 2.8 && tris > 600) kind = 'stump';
      else if (h > 8 && tris > 2000) kind = 'mature';
      else if (h > 7.4 && h < 8.2 && w > 5 && w < 6.2 && tris > 600) kind = 'forest';
      if (!kind) return;
      const MatCtor = (o as unknown as { matrixWorld: { constructor: new () => unknown } }).matrixWorld.constructor;
      const m = new MatCtor();
      for (let i = 0; i < o.count; i++) {
        o.getMatrixAt(i, m);
        const p = new Vec().setFromMatrixPosition(m);
        const key = `${kind}:${p.x.toFixed(1)}:${p.z.toFixed(1)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ kind, x: p.x, y: p.y, z: p.z });
      }
    });
    return out;
  });
}

async function listMeshes(page: Page): Promise<void> {
  const rows = await page.evaluate(() => {
    const air = (window as unknown as { __probe: { observe: { air: { scene: { traverse(f: (o: never) => void): void } } } } }).__probe.observe.air;
    const out: string[] = [];
    air.scene.traverse((o: { isInstancedMesh?: boolean; count: number; geometry: { index: { count: number } | null; attributes: { position: { count: number } }; boundingBox: { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } } | null; computeBoundingBox(): void }; material: { name: string } }) => {
      if (!o.isInstancedMesh) return;
      const g = o.geometry;
      if (!g.boundingBox) g.computeBoundingBox();
      const b = g.boundingBox!;
      const tris = (g.index ? g.index.count : g.attributes.position.count) / 3;
      out.push(`${o.material.name} n=${o.count} tris=${tris} size=${(b.max.x - b.min.x).toFixed(2)}x${(b.max.y - b.min.y).toFixed(2)}x${(b.max.z - b.min.z).toFixed(2)}`);
    });
    return out;
  });
  console.log(rows.join('\n'));
}

async function setCamera(page: Page, cam: Cam): Promise<void> {
  await page.evaluate((c) => {
    const air = (window as unknown as { __probe: { observe: { air: { camera: { position: { set(x: number, y: number, z: number): void }; lookAt(x: number, y: number, z: number): void }; controls: { target: { set(x: number, y: number, z: number): void }; update(): void } } } } }).__probe.observe.air;
    air.camera.position.set(...c.pos);
    air.controls.target.set(...c.target);
    air.camera.lookAt(...c.target);
    air.controls.update();
  }, cam);
  await page.waitForTimeout(1500);
}

/** GLB のノードを場面に足す (観察画面と同じ読み込み・焼きの手順で)。丸太と、この保存では生えていない森の木に使う */
async function addNode(page: Page, glbName: string, node: string, at: [number, number, number], yaw: number): Promise<void> {
  await page.evaluate(
    async ([glbFile, nodeName, x, y, z, ry]) => {
      // ページの Vite が配る同じモジュール (観察画面と同じ three・同じ焼きの材質) を読む
      const assetsUrl = '/src/observe/render/assets.ts';
      const assets = (await import(/* @vite-ignore */ assetsUrl)) as {
        loadGlb(url: string): Promise<{ scene: { getObjectByName(n: string): { clone(): { position: { set(x: number, y: number, z: number): void }; rotation: { y: number }; traverse(f: (o: { castShadow: boolean; receiveShadow: boolean }) => void): void } } | undefined } } | null>;
      };
      const glb = await assets.loadGlb(`/assets/models/observe/${glbFile}`);
      const node = glb!.scene.getObjectByName(nodeName)!.clone();
      node.position.set(x, y, z);
      node.rotation.y = ry;
      node.traverse((o) => {
        o.castShadow = true;
        o.receiveShadow = true;
      });
      const air = (window as unknown as { __probe: { observe: { air: { scene: { add(o: unknown): void } } } } }).__probe.observe.air;
      air.scene.add(node);
    },
    [glbName, node, ...at, yaw] as [string, string, number, number, number, number],
  );
}

async function main(): Promise<void> {
  const url = arg('--url', 'http://127.0.0.1:5611')!;
  const out = resolve(arg('--out', '.bench/flora-shots')!);
  const prefix = arg('--prefix', '')!;
  mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ headless: !process.argv.includes('--headed'), args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: VIEWPORT });
  await page.goto(`${url}/observe.html?time=0.3&freeze=1&auto=0&ship=60`);
  await page.addStyleTag({ content: HIDE_DEV_UI });
  await page.waitForFunction(() => (window as unknown as { __probe?: { observe?: { stats(): unknown } } }).__probe?.observe?.stats() != null, null, { timeout: 60000 });
  await page.waitForTimeout(3000);
  if (process.argv.includes('--list')) {
    await listMeshes(page);
    await browser.close();
    return;
  }
  const placed = await findPlaced(page);
  // 株は地面の高い (水際でない) ものから
  const stumps = placed.filter((p) => p.kind === 'stump').sort((a, b) => b.y - a.y);
  const matures = placed.filter((p) => p.kind === 'mature').sort((a, b) => a.x - b.x || a.z - b.z);
  console.log(`株 ${stumps.length}・成木 ${matures.length}`);
  const shots: { name: string; cam: Cam }[] = [];
  const s = stumps[0];
  if (s) {
    shots.push({ name: 'stump', cam: { pos: [s.x + 2.2, s.y + 1.7, s.z + 2.2], target: [s.x, s.y + 0.45, s.z] } });
    shots.push({ name: 'stump-far', cam: { pos: [s.x + 5.5, s.y + 3.2, s.z + 5.5], target: [s.x, s.y + 0.5, s.z] } });
    // 丸太は株の 2.8 m 横の、地面のいちばん高い向きに置く (水際を避ける)
    const ground = (x: number, z: number) => page.evaluate(([gx, gz]) => (window as unknown as { __probe: { observe: { air: { heightAt(x: number, z: number): number } } } }).__probe.observe.air.heightAt(gx, gz), [x, z]);
    let best = { a: 0, y: -Infinity };
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      const y = await ground(s.x + Math.cos(a) * 2.8, s.z + Math.sin(a) * 2.8);
      if (y > best.y) best = { a, y };
    }
    const lx = s.x + Math.cos(best.a) * 2.8;
    const lz = s.z + Math.sin(best.a) * 2.8;
    await addNode(page, 'belltree.glb', 'belltree_logs', [lx, best.y + 0.02, lz], best.a + Math.PI / 2);
    const side = best.a - Math.PI / 2;
    shots.push({ name: 'logs', cam: { pos: [lx + Math.cos(side) * 2.8, best.y + 1.4, lz + Math.sin(side) * 2.8], target: [lx, best.y + 0.4, lz] } });
    shots.push({ name: 'stump-logs', cam: { pos: [(s.x + lx) / 2 + Math.cos(side) * 5.5, s.y + 2.6, (s.z + lz) / 2 + Math.sin(side) * 5.5], target: [(s.x + lx) / 2, s.y + 0.4, (s.z + lz) / 2] } });
  }
  const m = matures[Math.floor(matures.length / 2)];
  if (m) {
    shots.push({ name: 'bark-mature', cam: { pos: [m.x + 2.6, m.y + 1.8, m.z + 1.4], target: [m.x, m.y + 1.6, m.z] } });
    shots.push({ name: 'mature-whole', cam: { pos: [m.x + 11, m.y + 4.5, m.z + 6], target: [m.x, m.y + 4.2, m.z] } });
  }
  // 森の木はこの保存 (空の舟 25 年目) では生えていないので、株の 7 m 先に 1 本足して幹に寄る
  if (s) {
    const fx = s.x + 7;
    const fz = s.z - 3;
    const fy = await page.evaluate(([gx, gz]) => (window as unknown as { __probe: { observe: { air: { heightAt(x: number, z: number): number } } } }).__probe.observe.air.heightAt(gx, gz), [fx, fz]);
    await addNode(page, 'flora.glb', 'forest_tree', [fx, fy - 0.1, fz], 0.3);
    shots.push({ name: 'bark-forest', cam: { pos: [fx + 1.9, fy + 1.5, fz + 1.1], target: [fx, fy + 1.2, fz] } });
  }
  for (const shot of shots) {
    await setCamera(page, shot.cam);
    await page.screenshot({ path: resolve(out, `${prefix}${shot.name}.png`) });
    console.log(`書いた ${prefix}${shot.name}.png`);
  }
  // 林の寄せ先 (審査台の grove.png と同じ)
  await page.goto(`${url}/observe.html?shot=林&time=0.3&freeze=1&auto=0&ship=60`);
  await page.addStyleTag({ content: HIDE_DEV_UI });
  await page.waitForTimeout(9000);
  await page.screenshot({ path: resolve(out, `${prefix}grove.png`) });
  console.log(`書いた ${prefix}grove.png`);
  await browser.close();
}

await main();
