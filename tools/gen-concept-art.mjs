#!/usr/bin/env node
/**
 * docs/design/2026-09-19-art-brief.md の一覧に沿って Gemini の画像生成 API で 2D コンセプト画を作る。
 *
 * 使い方:
 *   GEMINI_API_KEY は .env (GEMINI_API_KEY=...) か環境変数で渡す
 *   node tools/gen-concept-art.mjs             # 全部
 *   node tools/gen-concept-art.mjs deer wolf   # 指定した assetId だけ
 *   GEMINI_IMAGE_MODEL=... で モデルを変更 (既定: gemini-2.5-flash-image)
 *   node tools/gen-concept-art.mjs --variants=3 deer wolf rabbit   # 1 体につき 3 パターン
 * 出力: assets/textures/concept/<assetId>.png (既にあればスキップ。--force で上書き)
 *       --variants=N のときは assets/textures/concept/<assetId>-v1.png … -vN.png
 *       (パターンごとに VARIANT_HINTS の方向性を付ける)
 *   node tools/gen-concept-art.mjs --style=angular deer rabbit wolf   # 採用済み方向性 (STYLE_PRESETS) で固定
 *       出力は <assetId>-<style>.png (--variants 併用で -v1..vN)
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = resolve(root, 'assets/textures/concept');

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

const COMMON =
  'Low-poly-friendly concept art for a browser ecosystem game. Clean silhouette, flat colors, 3-5 colors max, ' +
  'no texture detail, single-color background (#F4F6F1), centered subject. ' +
  'Style: lost-continent (Mu / Atlantis) mystery for teenage readers, ancient stone tablets, glowing crystals, ' +
  'but keep it bright and readable. No text in the image. Square composition.';

/** 発注書 §1〜§3 の一覧。プロンプトは英語 */
const ITEMS = [
  { id: 'grass', prompt: 'A tuft of glowing "moon grass": 3-5 short leaves, circular from above, 3/4 view. Main color #6FBF7C.' },
  { id: 'forest', prompt: 'A single "bell tree": bell-shaped canopy on a thick trunk, three times taller than grass, 3/4 view. Main color #2E6B37, trunk brown.' },
  { id: 'deer', prompt: 'A "moon deer": deer with crescent-moon shaped antlers, slender legs, side 3/4 view, silhouette instantly readable as a deer. Main color #E2B45A.' },
  { id: 'rabbit', prompt: 'An "earth rabbit": round body, long ears, half the size of a deer, 3/4 view. Main color #D6C27A.' },
  { id: 'wolf', prompt: 'An "ash wolf": low crouching posture, pointed ears and tail, clearly a predator next to a deer, 3/4 view. Main color #E07A55.' },
  { id: 'stone-tablet', prompt: 'A tall standing stone tablet with a star emblem at the top and engraved prophecy lines below (abstract marks, not letters), 3/4 view. Grey stone with faint blue glow in the lines.' },
  { id: 'crystal', prompt: 'A cluster of hexagonal prism crystals ("bright stones") glowing pale blue-green, growing from a crack in the ground, 3/4 view.' },
  { id: 'star-sand', prompt: 'A small crater rim with a drift of faintly glowing pale sand and meteorite fragments, 3/4 view.' },
  { id: 'weather-tower', prompt: 'A slender ancient tower with a floating ring on top that gathers clouds, 3/4 view. Stone and pale metal.' },
  { id: 'sky-ship', prompt: 'A floating wooden ship with sails, hovering above ground, carrying seeds and small animals, 3/4 view.' },
  { id: 'ley-line', prompt: 'Top-down view of ground with a glowing crack running across it like a vein of light (a "ley line"), pale blue-green glow.' },
  { id: 'key-visual-island', prompt: 'Isometric top-down view of a small island: green forest patches, yellow-green grassland, sand-colored dry land, grey highlands, white peaks, a few lakes, deep blue sea around. A faint beam of light from a stone tablet at the center.' },
  { id: 'key-visual-doom-sinking', prompt: 'Isometric top-down view of a small island being swallowed by rising sea; coastline shrinking, animals moving uphill. Deep blue sea, dramatic but readable.' },
  { id: 'key-visual-doom-falling-star', prompt: 'Isometric top-down view of a small island at night with a bright meteor streaking toward its center; forests and animals visible.' },
  { id: 'key-visual-doom-volcano', prompt: 'Isometric top-down view of a small island with a central volcano erupting red smoke, half the island darkened by ash; the other half still green.' },
];

/** --variants=N のとき、n 番目 (1 始まり) のパターンに付ける方向性。N が超えたら循環 */
const VARIANT_HINTS = [
  'Variant A — realistic proportions: anatomically faithful body, natural stance, restrained stylization.',
  'Variant B — chibi / mascot: big head, short limbs, rounded shapes, friendly and cute.',
  'Variant C — angular geometric: sharp facet-like planes, exaggerated silhouette, bold and stylized.',
];

/** --style=<key> で採用済みの方向性を固定する。出力は <assetId>-<key>.png */
const STYLE_PRESETS = {
  // deer-v3 (angular geometric) を採用し、等身を 3〜5 頭身に下げたもの
  angular:
    'Adopted style — angular geometric low-poly: sharp facet-like planes, bold exaggerated silhouette, ' +
    'thin glowing cyan (#9FF5E8) edge highlights along a few facets, warm flat base colors. ' +
    'Proportions (strict): 3 to 5 heads tall, i.e. total body height is only 3-5 times the head height — ' +
    'a compact, slightly stocky body, legs and neck shortened aggressively (legs no longer than the torso depth), ' +
    'head clearly larger than realistic, like a stylized figurine or a Pokémon-scale creature; ' +
    'NOT chibi, still readable as the animal. Keep all species-defining features from the subject description. ' +
    'Single subject only, no other animals, no props, no ground objects except a small shadow.',
};

async function generate(item, variant = 0, style = '') {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;
  const hint = style
    ? `\n\nStyle direction: ${STYLE_PRESETS[style]}`
    : variant
      ? `\n\nStyle direction: ${VARIANT_HINTS[(variant - 1) % VARIANT_HINTS.length]}`
      : '';
  const body = {
    contents: [{ parts: [{ text: `${COMMON}\n\nSubject: ${item.prompt}${hint}` }] }],
    generationConfig: { responseModalities: ['IMAGE'] },
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': KEY },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${item.id}: HTTP ${res.status} ${await res.text()}`);
  const json = await res.json();
  const parts = json.candidates?.[0]?.content?.parts ?? [];
  const img = parts.find((p) => p.inlineData?.data);
  if (!img) throw new Error(`${item.id}: 画像が返りませんでした: ${JSON.stringify(json).slice(0, 300)}`);
  return Buffer.from(img.inlineData.data, 'base64');
}

const args = process.argv.slice(2);
const force = args.includes('--force');
const variants = Number(args.find((a) => a.startsWith('--variants='))?.split('=')[1] ?? 0);
const style = args.find((a) => a.startsWith('--style='))?.split('=')[1] ?? '';
if (style && !STYLE_PRESETS[style]) {
  console.error(`未知の --style: ${style} (候補: ${Object.keys(STYLE_PRESETS).join(', ')})`);
  process.exit(1);
}
const wanted = args.filter((a) => !a.startsWith('--'));
mkdirSync(outDir, { recursive: true });
let ok = 0;
let ng = 0;
for (const item of ITEMS) {
  if (wanted.length && !wanted.includes(item.id)) continue;
  // variants 未指定なら従来どおり 1 枚 (variant=0)、指定時は v1..vN
  const jobs = variants > 0 ? Array.from({ length: variants }, (_, i) => i + 1) : [0];
  for (const v of jobs) {
    const name = style ? `${item.id}-${style}${v ? `-v${v}` : ''}` : v ? `${item.id}-v${v}` : item.id;
    const out = resolve(outDir, `${name}.png`);
    if (existsSync(out) && !force) {
      console.log(`skip ${name} (exists)`);
      continue;
    }
    try {
      const png = await generate(item, v, style);
      writeFileSync(out, png);
      console.log(`ok   ${name} -> ${out} (${png.length} bytes)`);
      ok++;
    } catch (e) {
      console.error(`fail ${name}: ${e instanceof Error ? e.message : String(e)}`);
      ng++;
    }
  }
}
console.log(`done: ${ok} generated, ${ng} failed`);
process.exit(ng ? 1 : 0);
