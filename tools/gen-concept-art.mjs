#!/usr/bin/env node
/**
 * docs/design/2026-09-19-art-brief.md の一覧に沿って Gemini の画像生成 API で 2D コンセプト画を作る。
 *
 * 使い方:
 *   GEMINI_API_KEY は .env (GEMINI_API_KEY=...) か環境変数で渡す
 *   node tools/gen-concept-art.mjs             # 全部
 *   node tools/gen-concept-art.mjs deer wolf   # 指定した assetId だけ
 *   GEMINI_IMAGE_MODEL=... で モデルを変更 (既定: gemini-2.5-flash-image)
 * 出力: assets/textures/concept/<assetId>.png (既にあればスキップ。--force で上書き)
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

async function generate(item) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;
  const body = {
    contents: [{ parts: [{ text: `${COMMON}\n\nSubject: ${item.prompt}` }] }],
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
const wanted = args.filter((a) => !a.startsWith('--'));
mkdirSync(outDir, { recursive: true });
let ok = 0;
let ng = 0;
for (const item of ITEMS) {
  if (wanted.length && !wanted.includes(item.id)) continue;
  const out = resolve(outDir, `${item.id}.png`);
  if (existsSync(out) && !force) {
    console.log(`skip ${item.id} (exists)`);
    continue;
  }
  try {
    const png = await generate(item);
    writeFileSync(out, png);
    console.log(`ok   ${item.id} -> ${out} (${png.length} bytes)`);
    ok++;
  } catch (e) {
    console.error(`fail ${item.id}: ${e instanceof Error ? e.message : String(e)}`);
    ng++;
  }
}
console.log(`done: ${ok} generated, ${ng} failed`);
process.exit(ng ? 1 : 0);
