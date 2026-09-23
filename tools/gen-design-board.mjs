#!/usr/bin/env node
/**
 * 観察画面(空の舟)のデザインボードを Gemini の画像生成 API で作る。方向性は docs/design/2026-09-23-observation-view.md。
 * 絵画的な写実のキービジュアル 4 枚と、アセットの基準画(動物・植物・集落・舟・地面・演出)を出す。
 *
 * 使い方:
 *   GEMINI_API_KEY は .env (GEMINI_API_KEY=...) か環境変数で渡す
 *   node tools/gen-design-board.mjs                  # 全部 (1 枚ずつ)
 *   node tools/gen-design-board.mjs --variants=2 kv-herd kv-shipyard
 *   node tools/gen-design-board.mjs --force sheet-deer
 *   GEMINI_IMAGE_MODEL=... で モデルを変更 (既定: gemini-2.5-flash-image)
 * 出力: assets/textures/board/<id>.png (--variants=N なら <id>-v1..vN.png)。既にあればスキップ
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = resolve(root, 'assets/textures/board');

function loadEnv() {
  const p = resolve(root, '.env');
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
loadEnv();
const KEY = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
if (!KEY) {
  console.error('GEMINI_API_KEY が見つかりません。.env に GEMINI_API_KEY=... を書いてください。');
  process.exit(1);
}
const MODEL = process.env.GEMINI_IMAGE_MODEL ?? 'gemini-2.5-flash-image';

const WORLD =
  'World: "Fragments of Mu" — a small island in a warm sea, a remnant of a sunken ancient civilization, ' +
  'with moss-covered megalithic stone ruins half swallowed by nature. ' +
  'Fantasy elements (keep them grounded and natural-looking): ' +
  'BELL TREES — tall broadleaf trees whose hanging seed pods are small bronze-coloured bell shapes that glow faintly warm; ' +
  'MOON DEER — ordinary four-legged deer whose antlers each form a smooth crescent-moon arc (a single smooth curved beam rising from each side of the head and curving inward so the pair reads as a crescent moon, at most one small brow tine, NOT a branching deer rack; modest size — about as tall as the head is long, never oversized horns); the intelligent ones wear only thin braided cords ' +
  'and small woven ornaments tied to their antlers (NOT anthropomorphic, never standing on two legs, no clothes, no tools in hooves); ' +
  'the SKY SHIP — a wooden ship built from pale bell-tree timber with woven fibre sails, meant to float in the air. ' +
  'No humans, no text, no letters, no UI, no watermark.';

const PAINTERLY =
  'Style: painterly realism, like the hand-painted background art of an animated feature film. ' +
  'Realistic anatomy, proportions and materials, but colours and light are composed like a painting: ' +
  'soft atmospheric perspective, gentle bloom on light sources, subtle visible brushwork, harmonious limited palette. ' +
  'Calm, tender mood — the feeling of quietly watching lives you have protected.';

const SCENE = `${PAINTERLY} ${WORLD} Wide 16:9 landscape composition, camera low and oblique like a nature documentary.`;
const SHEET =
  `${PAINTERLY} ${WORLD} Reference sheet for a 3D modeller: plain warm light-grey background, ` +
  'even soft studio light, each item separated with space, consistent scale noted by relative size only (no labels, no text). 16:9.';

/** 観察画面の方向性 (§決定 1・5・6・7・10) を絵にする。kind: scene はキービジュアル、sheet は基準画 */
const ITEMS = [
  { id: 'kv-herd', kind: 'scene', prompt: 'Early morning mist in a bell-tree grove at the edge of a small settlement. A herd of moon deer grazes on dewy grass among young and mature bell trees; a fawn stays close to its mother; one deer with cord-braided antlers looks back toward the ruins. Shafts of low golden sunlight through the canopy, the bells glowing faintly. No ship anywhere in this scene.' },
  { id: 'kv-shipyard', kind: 'scene', prompt: 'Late afternoon at the deer settlement: megalithic ruins that the deer have restacked and roofed with vines and bark, warm lanterns hanging from stone posts. On a stone slipway, the sky ship is half built — keel and curved ribs, some planks fixed. Moon deer carry pale bell-tree logs dragged by braided cords; fresh stumps of cut bell trees nearby. Busy but peaceful.' },
  { id: 'kv-departure', kind: 'scene', prompt: 'Dusk. The finished sky ship, sails unfurled, lifts gently off the stone slipway and rises toward the horizon over the sea. The moon deer have gathered below and some are aboard; bell trees glow warm; the sky is deep blue to amber. A sense of farewell and hope.' },
  { id: 'kv-sinking', kind: 'scene', prompt: 'Overcast day. The sea has risen over the low edge of the island: waves wash through the lower bell-tree grove, drowned trunks stand in shallow water, a lantern post leans in the surf. On higher ground the deer herd moves uphill; a faint pale glow rises from the ground where a creature has died and returned to the soil. Melancholic but not violent, no blood. No ship anywhere in this scene (the ship was never finished).' },
  { id: 'sheet-deer', kind: 'sheet', prompt: 'Moon deer: adult stag (side view, front view, three-quarter view), adult doe WITHOUT antlers (side view), fawn WITHOUT antlers with spotted coat (side view). One "intelligent" stag variant with braided cords and a small woven ornament on the crescent antlers. Warm tawny coat with pale belly, natural realistic fur.' },
  { id: 'sheet-wolf', kind: 'sheet', prompt: 'Ash wolf: grey-ash coat with darker back and pale muzzle, lean predator. Side view, three-quarter view, a crouching stalking pose, and a running pose.' },
  { id: 'sheet-rabbit', kind: 'sheet', prompt: 'Earth rabbit: sturdy wild rabbit with earthy sand-brown fur and long ears, half the height of a deer\'s leg. Side view, three-quarter view, sitting upright alert pose, grazing pose.' },
  { id: 'sheet-belltree', kind: 'sheet', prompt: 'Bell tree growth stages left to right: seedling just sprouted (with a soft sprouting glow), sapling, young tree, mature tree with hanging bronze-bell seed pods glowing faintly, and a freshly cut stump with pale timber. Plus a stack of pale bell-tree logs.' },
  { id: 'sheet-flora', kind: 'sheet', prompt: 'Ground flora: a tuft of moon grass (slender pale-green blades with a faint silver sheen), a clump of meadow grass, a patch of spore moss on a stone (bright green, tiny glowing spore heads in damp shade), and an ordinary broadleaf forest tree for contrast with the bell tree.' },
  { id: 'sheet-settlement', kind: 'sheet', prompt: 'Modular pieces of the deer settlement built into Mu megalithic ruins: a restacked stone shelter with a vine-and-bark roof, a stone post with a hanging warm lantern, a low dry-stone wall, a woven fibre screen, and the long stone slipway where the ship is built. Weathered stone with moss.' },
  { id: 'sheet-ship', kind: 'sheet', prompt: 'Sky ship construction stages left to right: laid keel on a stone slipway, keel with curved ribs, partially planked hull, fully planked hull with mast, finished ship with woven fibre sails floating slightly above the ground. Pale bell-tree timber, braided rope rigging, small bronze bells hung along the rail.' },
  { id: 'sheet-terrain', kind: 'sheet', prompt: 'Ground material swatches as square tiles seen from above at an angle: lush meadow grass, trampled grass with bare soil, dark forest floor with fallen leaves, weathered granite rock with moss, pale sand beach, wet sand with a thin wave edge, shallow turquoise sea over sand, eroded coastline where grass meets water.' },
  { id: 'sheet-effects', kind: 'sheet', prompt: 'Visual effect studies as small vignettes: (1) a fallen deer dissolving into drifting pale-green motes of light returning to the soil (vitality), (2) a low sickly violet-grey plague mist creeping between trees, (3) seedlings sprouting with a soft burst of light where a player planted bell trees, (4) lanterns dimming and a workshop fire going out, (5) gentle rain over the grove, (6) rising sea water lapping over grass.' },
];

async function generate(item) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;
  const base = item.kind === 'scene' ? SCENE : SHEET;
  const body = {
    contents: [{ parts: [{ text: `${base}\n\nSubject: ${item.prompt}` }] }],
    generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: '16:9' } },
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': KEY },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${item.id}: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
  const json = await res.json();
  const parts = json.candidates?.[0]?.content?.parts ?? [];
  const img = parts.find((p) => p.inlineData?.data);
  if (!img) throw new Error(`${item.id}: 画像が返りませんでした: ${JSON.stringify(json).slice(0, 300)}`);
  return Buffer.from(img.inlineData.data, 'base64');
}

const args = process.argv.slice(2);
const force = args.includes('--force');
const variants = Number(args.find((a) => a.startsWith('--variants='))?.split('=')[1] ?? 0);
const wanted = args.filter((a) => !a.startsWith('--'));
const unknown = wanted.filter((w) => !ITEMS.some((i) => i.id === w));
if (unknown.length) {
  console.error(`未知の id: ${unknown.join(', ')} (候補: ${ITEMS.map((i) => i.id).join(', ')})`);
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });
let ok = 0;
let ng = 0;
for (const item of ITEMS) {
  if (wanted.length && !wanted.includes(item.id)) continue;
  const names = variants > 0 ? Array.from({ length: variants }, (_, i) => `${item.id}-v${i + 1}`) : [item.id];
  for (const name of names) {
    const out = resolve(outDir, `${name}.png`);
    if (existsSync(out) && !force) {
      console.log(`skip ${name} (exists)`);
      continue;
    }
    try {
      const png = await generate(item);
      writeFileSync(out, png);
      console.log(`ok   ${name} (${png.length} bytes)`);
      ok++;
    } catch (e) {
      console.error(`fail ${name}: ${e instanceof Error ? e.message : String(e)}`);
      ng++;
    }
  }
}
console.log(`done: ${ok} generated, ${ng} failed`);
process.exit(ng ? 1 : 0);
