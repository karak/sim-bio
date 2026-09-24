import {
  AdditiveBlending,
  BufferAttribute,
  NormalBlending,
  Vector2,
  type WebGLRenderer,
  BufferGeometry,
  Color,
  Group,
  Mesh,
  PlaneGeometry,
  Points,
  ShaderMaterial,
  Vector3,
} from 'three';
import type { Agent } from '../agents';
import { SPROUT_DRAG, sproutBurst, sproutReach } from '../fx';

/**
 * 空気の中の光の粒 (M22-07、基準画 sheets/effects の 1「倒れた鹿から立つ生気の粒」と key-visuals/herd の光の中の塵)。
 * - 塵: 昼、カメラの周りの箱の中を漂う暖かい粒。箱はシェーダで折り返すので、粒を動かす計算はしない。
 * - 蛍: 夜、草地と林の低い所を漂い、ゆっくり明滅する緑がかったシアンの粒。
 * - 生気: 還る個体 (state = return) の体から立ちのぼるシアンの粒。粒の出入りだけ CPU で数える。
 * - 灯りの溜まり: 夜、灯り柱の足元の地面を照らす暖かい円 (点光源は材質全部の計算を重くするので、地面に沿わせた板で描く)。
 * どれも加算合成で深度を書かず、bloom の閾値を越える明るさで滲ませる。
 */
const DUST = 700;
const DUST_BOX = 36;
const FIREFLIES = 260;
const VITALITY = 1200;
const VITALITY_LIFE = 2.6;
const VITALITY_RATE = 32;
/** 芽吹き (M22-08、sheets/effects の 3): 植えた所の地面から金色の粒が立つ。雨 (5): カメラの周りに降る筋 */
// (M22-07 の手直しで変更: 粒を 500 → 900 に。植えた点から放射状に飛び出す粒にした (fx.ts の sproutBurst))
const SPROUT = 900;
const SPROUT_LIFE = 7;
/** (M22-07 の手直し、芽吹き「粒の広がりと放射の鋭さがどちらも足りない」) 放射の広がり (m) は植えた円の半径のこの倍、下限 SPROUT_MIN_R */
const SPROUT_SPREAD = 1.8;
const SPROUT_MIN_R = 16;
/** (M22-07 の手直し) 地面の放射の光の残る秒数 */
const BURST_S = 6;
/** (M22-07 の手直し) 1 回の芽吹きで飛ばす粒の数 */
const SPROUT_PER_BURST = 640;
/** (M22-07 の手直し) 雨の跳ね返り: 同時に出せる数・1 秒に置く数 (雨の強さ 1 のとき)・1 つの長さ (秒) */
const SPLASH = 1600;
const SPLASH_RATE = 4000;
const SPLASH_LIFE = 0.32;
/** (M22-07 の手直し) 跳ね返りのうち屋根の上に寄せる割合 */
const ROOF_SHARE = 0.22;
const RAIN = 3000;
const RAIN_BOX = 30;

const pointVertex = /* glsl */ `
  attribute float aSeed;
  attribute float aAlpha;
  uniform float uTime;
  uniform float uSize;
  uniform float uScale;
  uniform int uMode;
  uniform vec3 uOrigin;
  uniform float uBox;
  uniform vec2 uViewport;
  attribute vec3 aVel;
  varying float vAlpha;
  varying vec3 vStreak;
  varying float vPhase;
  void main() {
    vec3 p = position;
    float a = aAlpha;
    vStreak = vec3(1.0, 0.0, 0.0);
    vPhase = aSeed;
    if (uMode == 0) {
      // 塵: 風で流し、カメラを中心にした箱の中へ折り返す
      p += vec3(0.35, 0.05, 0.18) * uTime + vec3(sin(uTime * 0.3 + aSeed * 6.0), sin(uTime * 0.23 + aSeed * 9.0), cos(uTime * 0.27 + aSeed * 4.0)) * 0.6;
      p = mod(p - uOrigin + uBox * 0.5, uBox) + uOrigin - uBox * 0.5;
      a *= 0.55 + 0.45 * sin(uTime * 1.7 + aSeed * 30.0);
    } else if (uMode == 3) {
      // 雨: カメラの周りの箱の中を落ち続ける (塵と同じく折り返す)
      p.y -= uTime * 11.0;
      p.x += uTime * 1.2;
      p = mod(p - uOrigin + uBox * 0.5, uBox) + uOrigin - uBox * 0.5;
    } else if (uMode == 1) {
      // 蛍: 元の場所の周りをゆっくり巡り、ときどき灯る
      p += vec3(sin(uTime * 0.37 + aSeed * 11.0) * 1.6, sin(uTime * 0.51 + aSeed * 7.0) * 0.45, cos(uTime * 0.29 + aSeed * 5.0) * 1.6);
      a *= pow(max(sin(uTime * (0.6 + aSeed * 0.5) + aSeed * 40.0), 0.0), 3.0);
    }
    vAlpha = a;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_PointSize = uSize * uScale / max(-mv.z, 0.5);
    gl_Position = projectionMatrix * mv;
    if (uMode == 4) {
      // (M22-07 の手直し) 芽吹きの放射の粒: 速さの向きに伸ばした筋。頭と尾 (0.2 秒前の位置) を画面に写し、点の中心を真ん中に置いて筋を収める
      vec4 tail = projectionMatrix * (modelViewMatrix * vec4(p - aVel * 0.2, 1.0));
      vec2 sa = gl_Position.xy / gl_Position.w;
      vec2 sb = tail.xy / max(tail.w, 1e-3);
      vec2 dpx = (sa - sb) * 0.5 * uViewport;
      float len = min(length(dpx), 180.0);
      float w = gl_PointSize;
      vStreak = vec3(len > 1e-3 ? dpx / length(dpx) : vec2(1.0, 0.0), len / (len + w));
      gl_Position.xy = (sa - normalize(dpx + 1e-6) * len / uViewport) * gl_Position.w;
      gl_PointSize = len + w;
    }
  }
`;

const pointFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uAmount;
  uniform float uStreak;
  varying float vAlpha;
  varying vec3 vStreak;
  varying float vPhase;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float soft = smoothstep(0.5, 0.0, d);
    // 雨の粒は縦の細い筋にする
    if (uStreak > 0.5) soft = smoothstep(0.06, 0.0, abs(gl_PointCoord.x - 0.5)) * smoothstep(0.5, 0.2, abs(gl_PointCoord.y - 0.5));
    // (M22-07 の手直し) 芽吹きの筋: 点の中の座標を速さの向き (頭が +) と横に分け、細い芯と頭の丸い光にする
    if (uStreak > 1.5 && uStreak < 2.5) {
      vec2 c = (gl_PointCoord - 0.5) * vec2(1.0, -1.0);
      float k = vStreak.z;
      float along = dot(c, vStreak.xy);
      float across = abs(dot(c, vec2(-vStreak.y, vStreak.x)));
      float hw = 0.5 * (1.0 - k);
      float t = clamp((along + 0.5 * k) / max(k, 1e-3), 0.0, 1.0);
      float core = smoothstep(hw * 0.45 + 0.004, 0.0, across) * step(abs(along), 0.5 * k) * t * t;
      float head = smoothstep(hw, 0.0, length(c - vStreak.xy * 0.5 * k));
      soft = max(core, head);
    }
    // (M22-07 の手直し) 雨の跳ね返り: 点の真ん中が当たった所。縁の飛沫が放物線で跳ね、平たい輪が広がって消える (vPhase 0〜1)
    if (uStreak > 2.5) {
      vec2 c = (gl_PointCoord - 0.5) * vec2(1.0, -1.0);
      float ph = vPhase;
      // 飛沫は真ん中の高い 1 つと左右に開く 2 つ。粒は大きめで柔らかく、跳ね上がって落ちる
      float crown = 0.0;
      for (int i = 0; i < 3; i++) {
        float fi = float(i) - 1.0;
        vec2 dp = vec2(fi * 0.16 * (0.3 + ph), sin(ph * 3.1416) * (0.36 - abs(fi) * 0.14));
        crown = max(crown, smoothstep(0.1 - 0.04 * ph, 0.0, length((c - dp) * vec2(1.0, 0.8))));
      }
      float ring = smoothstep(0.05, 0.0, abs(length(c * vec2(1.0, 3.0)) - (0.1 + ph * 0.32))) * 0.6;
      soft = max(crown * 0.85, ring) * (1.0 - ph * ph);
    }
    float a = soft * soft * vAlpha * uAmount;
    if (a < 0.003) discard;
    gl_FragColor = vec4(uColor * a, a);
  }
`;

function pointMaterial(color: string, intensity: number, size: number, mode: number): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uSize: { value: size },
      uScale: { value: 400 },
      uMode: { value: mode },
      uOrigin: { value: new Vector3() },
      uBox: { value: DUST_BOX },
      uColor: { value: new Color(color).multiplyScalar(intensity) },
      uAmount: { value: 1 },
      // (M22-07 の手直しで変更: 芽吹きの筋 (mode 4) は 2、雨の跳ね返り (mode 5) は 3)
      uStreak: { value: mode === 3 ? 1 : mode === 4 ? 2 : mode === 5 ? 3 : 0 },
      // (M22-07 の手直し) 描く先の大きさ (画素)。芽吹きの筋を画面の長さで伸ばすのに使う
      uViewport: { value: new Vector2(1, 1) },
    },
    vertexShader: pointVertex,
    fragmentShader: pointFragment,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  });
}

function points(count: number, mat: ShaderMaterial, fill: (i: number, p: Float32Array, seed: Float32Array, alpha: Float32Array) => void): Points {
  const pos = new Float32Array(count * 3);
  const seed = new Float32Array(count);
  const alpha = new Float32Array(count);
  for (let i = 0; i < count; i++) fill(i, pos, seed, alpha);
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos, 3));
  g.setAttribute('aSeed', new BufferAttribute(seed, 1));
  g.setAttribute('aAlpha', new BufferAttribute(alpha, 1));
  const p = new Points(g, mat);
  p.frustumCulled = false;
  p.renderOrder = 2;
  return p;
}

const poolFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uAmount;
  varying vec2 vUv;
  void main() {
    float d = length(vUv - 0.5) * 2.0;
    float a = pow(max(1.0 - d, 0.0), 2.2) * uAmount;
    gl_FragColor = vec4(uColor * a, a);
  }
`;

/**
 * (M22-07 の手直し、芽吹き「放射の鋭さ」) 地面の放射の光。中心から 22 本の鋭い筋 (粒の飛ぶ向き、fx.ts の sproutBurst と同じ角度) が
 * 広がる輪の内側に伸び、中心が光る。筋の長さは筋ごとに 0.55〜1.2 倍。年齢 uAge (秒) で広がり、薄れる
 */
const burstFragment = /* glsl */ `
  uniform float uAge;
  uniform float uR;
  uniform vec2 uCenter;
  uniform vec3 uColor;
  varying vec2 vXZ;
  float h1(float n) { return fract(sin(n * 91.345) * 43758.5453); }
  void main() {
    vec2 v = (vXZ - uCenter) / uR;
    float rho = length(v);
    if (rho > 1.0) discard;
    float front = 1.0 - exp(-3.4 * uAge);
    float th = mod(atan(v.y, v.x), 6.28318);
    float N = 22.0;
    float sector = floor(th / 6.28318 * N);
    float center = (sector + 0.5) / N * 6.28318;
    float arc = abs(th - center) * rho * uR;
    float len = 0.55 + 0.65 * h1(sector + 3.0);
    float tip = front * len;
    float width = 0.1 + 0.28 * rho;
    float ray = smoothstep(width, 0.0, arc) * smoothstep(tip, tip * 0.7, rho) * (1.0 - 0.5 * rho) * exp(-uAge / 1.7);
    float ring = smoothstep(0.035, 0.0, abs(rho - front * 0.92)) * exp(-uAge / 1.1);
    float core = exp(-rho * rho * 140.0) * exp(-uAge / 2.6) * 1.1;
    float glowDisc = 0.18 * smoothstep(front, 0.0, rho) * exp(-uAge / 2.2);
    float I = ray * 1.25 + ring * 0.9 + core + glowDisc;
    if (I < 0.003) discard;
    gl_FragColor = vec4(uColor * I, I);
  }
`;

/** (M22-07 の手直し) 中心 (x, z)・半径 R の円を地面に沿わせた板 (lift m 浮かせる)。芽吹きの地面の光に使う */
function drapedDisc(x: number, z: number, R: number, heightAt: (x: number, z: number) => number, lift: number): BufferGeometry {
  const g = new PlaneGeometry(R * 2, R * 2, 36, 36);
  g.rotateX(-Math.PI / 2);
  const pos = g.getAttribute('position') as BufferAttribute;
  for (let i = 0; i < pos.count; i++) pos.setY(i, heightAt(x + pos.getX(i), z + pos.getZ(i)) + lift);
  g.translate(x, 0, z);
  return g;
}

// (M22-07 の手直しで変更: surfaceAt は雨の跳ね返りを置く面の高さ (屋根の上は屋根、無ければ heightAt)。roofPoints は屋根の上の点 (x・y・z の並び、render/roofs.ts))
export type MotesInput = { rng: () => number; heightAt(x: number, z: number): number; lanterns: { x: number; z: number }[]; fireflyAt: { x: number; z: number }[]; surfaceAt?(x: number, z: number): number; roofPoints?: Float32Array };
export type Motes = {
  group: Group;
  // (M22-07 の手直しで変更: camera は向きも読む (雨の跳ね返りを画面の前に置く))
  update(t: number, dt: number, night: number, camera: { position: Vector3; getWorldDirection(target: Vector3): Vector3 }, target: Vector3, agents: readonly Agent[]): void;
  /** 芽吹き: at を中心に半径 radiusM の地面から金色の粒を立てる */
  sprout(at: { x: number; z: number }, radiusM: number): void;
  /** 雨の強さ (0〜1) */
  setRain(amount: number): void;
  /** 集落の灯りの強さ (0〜1)。帆を失うと民が灯りを消す (M22-08) */
  setLamps(amount: number): void;
};

export function createMotes(input: MotesInput): Motes {
  const { rng, heightAt } = input;
  const group = new Group();
  group.name = 'observe-motes';

  const dustMat = pointMaterial('#FFE8C0', 1.4, 0.07, 0);
  const dust = points(DUST, dustMat, (i, p, seed, alpha) => {
    p.set([rng() * DUST_BOX, rng() * DUST_BOX * 0.35, rng() * DUST_BOX], i * 3);
    seed[i] = rng();
    alpha[i] = 0.5 + rng() * 0.5;
  });

  const flyMat = pointMaterial('#A8FFD8', 2.2, 0.16, 1);
  const spots = input.fireflyAt.length ? input.fireflyAt : [{ x: 0, z: 0 }];
  const flies = points(FIREFLIES, flyMat, (i, p, seed, alpha) => {
    const s = spots[Math.floor(rng() * spots.length)];
    const x = s.x + (rng() - 0.5) * 8;
    const z = s.z + (rng() - 0.5) * 8;
    p.set([x, heightAt(x, z) + 0.4 + rng() * 1.8, z], i * 3);
    seed[i] = rng();
    alpha[i] = 0.6 + rng() * 0.4;
  });

  const vitMat = pointMaterial('#9CF7D8', 3.2, 0.2, 2);
  const vit = points(VITALITY, vitMat, (_i, _p, seed, alpha) => {
    alpha[_i] = 0;
    seed[_i] = 0;
  });
  const vPos = vit.geometry.getAttribute('position') as BufferAttribute;
  const vAlpha = vit.geometry.getAttribute('aAlpha') as BufferAttribute;
  const life = new Float32Array(VITALITY);
  const vel = new Float32Array(VITALITY * 3);
  let next = 0;
  const debt = new Map<number, number>();

  const poolMat = new ShaderMaterial({
    uniforms: { uColor: { value: new Color('#FFB866').multiplyScalar(1.1) }, uAmount: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: poolFragment,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    polygonOffset: true,
    polygonOffsetFactor: -2,
  });
  for (const l of input.lanterns) {
    // 灯りの溜まりは斜面に沿わせる (平らな板だと半分が地面に埋まる)
    const size = 9;
    const g = new PlaneGeometry(size, size, 8, 8);
    g.rotateX(-Math.PI / 2);
    const pos = g.getAttribute('position') as BufferAttribute;
    for (let i = 0; i < pos.count; i++) pos.setY(i, heightAt(l.x + pos.getX(i), l.z + pos.getZ(i)) + 0.06);
    g.translate(l.x, 0, l.z);
    const m = new Mesh(g, poolMat);
    m.renderOrder = 1;
    group.add(m);
  }
  // (0.16 では引きの画 (26 m) で昼の地面に紛れて見えなかった。自然記録の距離で金の粒として読める大きさに)
  // (M22-07 の手直しで変更: 粒は植えた点から放射状に飛び出す筋 (mode 4) にし、大きさは 0.45 m。広がりと鋭さは筋の長さと数で出す)
  const sproutMat = pointMaterial('#FFD27A', 3.0, 0.45, 4);
  const sprouts = points(SPROUT, sproutMat, (i, _p, seed, alpha) => {
    alpha[i] = 0;
    seed[i] = 0;
  });
  const sPos = sprouts.geometry.getAttribute('position') as BufferAttribute;
  const sAlpha = sprouts.geometry.getAttribute('aAlpha') as BufferAttribute;
  const sVel = new BufferAttribute(new Float32Array(SPROUT * 3), 3);
  sprouts.geometry.setAttribute('aVel', sVel);
  const sLife = new Float32Array(SPROUT);
  const sQueue: { x: number; z: number; r: number; left: number }[] = [];
  let sNext = 0;
  // (M22-07 の手直し) 粒ごとの飛び方 (植えた点・向き・速さ・上向きの初速・経った秒数・寿命)
  const sAt = new Float32Array(SPROUT * 3);
  const sDir = new Float32Array(SPROUT * 2);
  const sSpeed = new Float32Array(SPROUT);
  const sUp = new Float32Array(SPROUT);
  const sAge = new Float32Array(SPROUT);
  const sLife0 = new Float32Array(SPROUT);
  // (M22-07 の手直し) 描く先の大きさ (画素) を芽吹きの筋と跳ね返りに渡し、粒の大きさも描く先の高さで決める (ピクセル比 2 の画面で半分にならない)
  const fbSize = new Vector2();
  const sizeFromTarget = (r: WebGLRenderer, m: ShaderMaterial) => {
    const tg = r.getRenderTarget();
    if (tg) fbSize.set(tg.width, tg.height);
    else r.getDrawingBufferSize(fbSize);
    (m.uniforms.uViewport.value as Vector2).copy(fbSize);
    m.uniforms.uScale.value = fbSize.y * 0.9;
  };
  sprouts.onBeforeRender = (r) => sizeFromTarget(r, sproutMat);

  // (M22-07 の手直し、芽吹き) 地面の放射の光: 植えた点から伸びる鋭い光の筋 (粒の飛ぶ向きと同じ 22 本)・広がる輪・中心の光。
  // 地面に沿わせた板 1 枚 (植えるたびに置き直す)。草の穂の中に光るよう、地面から少し浮かせる
  const burstMat = new ShaderMaterial({
    uniforms: { uAge: { value: BURST_S }, uR: { value: 20 }, uCenter: { value: new Vector2() }, uColor: { value: new Color('#FFD27A').multiplyScalar(2.4) } },
    vertexShader: 'varying vec2 vXZ; void main() { vXZ = (modelMatrix * vec4(position, 1.0)).xz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: burstFragment,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    polygonOffset: true,
    polygonOffsetFactor: -2,
  });
  const burst = new Mesh(new BufferGeometry(), burstMat);
  burst.visible = false;
  burst.renderOrder = 1;
  burst.frustumCulled = false;
  let burstAge = BURST_S;

  // (M22-07 の手直し、雨「屋根や地面での跳ね返りがない」) 雨の跳ね返り: 画面の前の地面と屋根に、雨の強さに比例して飛沫の冠を置く
  const surfaceAt = input.surfaceAt ?? heightAt;
  const roofPts = input.roofPoints ?? new Float32Array(0);
  const roofN = roofPts.length / 3;
  const splashMat = pointMaterial('#EEF4F6', 1.0, 0.6, 5);
  splashMat.blending = NormalBlending;
  splashMat.premultipliedAlpha = true;
  splashMat.uniforms.uAmount.value = 0;
  const splashes = points(SPLASH, splashMat, (i, _p, seed, alpha) => {
    alpha[i] = 0;
    seed[i] = 1;
  });
  splashes.visible = false;
  splashes.onBeforeRender = (r) => sizeFromTarget(r, splashMat);
  const pPos = splashes.geometry.getAttribute('position') as BufferAttribute;
  const pPhase = splashes.geometry.getAttribute('aSeed') as BufferAttribute;
  const pAlpha = splashes.geometry.getAttribute('aAlpha') as BufferAttribute;
  const pLife = new Float32Array(SPLASH);
  let pNext = 0;
  let pDebt = 0;
  let rainAmount = 0;
  const fwd = new Vector3();

  const rainMat = pointMaterial('#E4EEF4', 1.8, 0.55, 3);
  rainMat.uniforms.uBox.value = RAIN_BOX;
  rainMat.uniforms.uAmount.value = 0;
  const rain = points(RAIN, rainMat, (i, p, seed, alpha) => {
    p.set([rng() * RAIN_BOX, rng() * RAIN_BOX, rng() * RAIN_BOX], i * 3);
    seed[i] = rng();
    alpha[i] = 0.5 + rng() * 0.4;
  });
  rain.visible = false;
  // (M22-07 の手直しで変更: 芽吹きの地面の光 burst と雨の跳ね返り splashes を足す)
  group.add(dust, flies, vit, sprouts, rain, burst, splashes);

  const up = new Vector3();
  let lamps = 1;
  return {
    group,
    update(t, dt, night, camera, target, agents) {
      const scale = window.innerHeight * 0.9;
      for (const m of [dustMat, flyMat, vitMat]) {
        m.uniforms.uTime.value = t;
        m.uniforms.uScale.value = scale;
      }
      (dustMat.uniforms.uOrigin.value as Vector3).copy(target);
      (rainMat.uniforms.uOrigin.value as Vector3).copy(camera.position);
      rainMat.uniforms.uTime.value = t;
      rainMat.uniforms.uScale.value = scale;
      // (M22-07 の手直しで変更: 芽吹きの粒の大きさは描く先の高さで決める (sprouts.onBeforeRender))
      // 芽吹き: 植えた円の中から 2 秒かけて粒を出し、ゆっくり立ちのぼらせる
      // (M22-07 の手直しで変更: 植えた点から放射状に一度に飛び出させる (出る時刻を 0〜0.5 秒ずらす)。抗力で止まるまでに植えた円の 1.8 倍 (下限 16 m) の 0.55〜1.35 倍まで広がり、
      //  弧を描いて浮き、そのあとはゆっくり立ちのぼって薄れる。筋の向きと長さは速さ (aVel) から)
      for (const q of sQueue) {
        const R = Math.max(SPROUT_MIN_R, q.r * SPROUT_SPREAD);
        const y0 = heightAt(q.x, q.z);
        for (let n = 0; n < SPROUT_PER_BURST; n++) {
          const k = sNext;
          sNext = (sNext + 1) % SPROUT;
          const b = sproutBurst(rng, R);
          sAt.set([q.x, y0, q.z], k * 3);
          sDir[k * 2] = Math.cos(b.angle);
          sDir[k * 2 + 1] = Math.sin(b.angle);
          sSpeed[k] = b.speed;
          sUp[k] = b.up;
          sAge[k] = -b.delay;
          sLife0[k] = SPROUT_LIFE * (0.6 + rng() * 0.4);
          sLife[k] = sLife0[k] + b.delay;
        }
        q.left = 0;
      }
      for (let i = sQueue.length - 1; i >= 0; i--) if (sQueue[i].left <= 0) sQueue.splice(i, 1);
      let sAny = false;
      for (let k = 0; k < SPROUT; k++) {
        if (sLife[k] <= 0) {
          if (sAlpha.getX(k) !== 0) sAlpha.setX(k, 0);
          continue;
        }
        sAny = true;
        sLife[k] -= dt;
        sAge[k] += dt;
        const age = sAge[k];
        if (age < 0) {
          sAlpha.setX(k, 0);
          continue;
        }
        const dist = sproutReach(sSpeed[k], age);
        const x = sAt[k * 3] + sDir[k * 2] * dist;
        const z = sAt[k * 3 + 2] + sDir[k * 2 + 1] * dist;
        const rise = (sUp[k] * (1 - Math.exp(-2.2 * age))) / 2.2 + 0.28 * age;
        sPos.setXYZ(k, x, heightAt(x, z) + 0.25 + rise, z);
        const hv = sSpeed[k] * Math.exp(-SPROUT_DRAG * age);
        sVel.setXYZ(k, sDir[k * 2] * hv, sUp[k] * Math.exp(-2.2 * age) + 0.28, sDir[k * 2 + 1] * hv);
        const f = Math.max(0, sLife[k] / sLife0[k]);
        sAlpha.setX(k, Math.min(1, age * 8) * Math.min(1, f * 2.5));
      }
      if (sAny || sQueue.length) {
        sPos.needsUpdate = true;
        sAlpha.needsUpdate = true;
        sVel.needsUpdate = true;
      }
      // (M22-07 の手直し) 地面の放射の光
      if (burstAge < BURST_S) {
        burstAge += dt;
        burstMat.uniforms.uAge.value = burstAge;
        burst.visible = burstAge < BURST_S;
      }
      // (M22-07 の手直し) 雨の跳ね返り: 毎秒 SPLASH_RATE × 雨の強さ を、カメラの前 (向きの 20 m 先を中心に半径 26 m) の地面と屋根に置く
      if (rainAmount > 0.01 || splashes.visible) {
        camera.getWorldDirection(fwd);
        const fl = Math.hypot(fwd.x, fwd.z) || 1;
        const cx = camera.position.x + (fwd.x / fl) * 20;
        const cz = camera.position.z + (fwd.z / fl) * 20;
        pDebt += dt * SPLASH_RATE * rainAmount;
        while (pDebt >= 1) {
          pDebt -= 1;
          const r = Math.sqrt(rng()) * 26;
          const a = rng() * Math.PI * 2;
          let x = cx + Math.cos(a) * r;
          let z = cz + Math.sin(a) * r;
          // 屋根は画面の中で面積が小さく、一様に置くと跳ね返りがほとんど見えないので、ROOF_SHARE を屋根の上の点に寄せる (カメラの前の円の中の屋根だけ)
          let y = Number.NaN;
          if (roofN > 0 && rng() < ROOF_SHARE) {
            const q = Math.floor(rng() * roofN) * 3;
            const rx = roofPts[q] + (rng() - 0.5) * 0.5;
            const rz = roofPts[q + 2] + (rng() - 0.5) * 0.5;
            if (Math.hypot(rx - cx, rz - cz) < 26) {
              x = rx;
              z = rz;
              y = roofPts[q + 1] + 0.12;
            }
          }
          // 海 (高さ 0.3 m 未満) には置かない (海面の波紋は water.ts)
          if (Number.isNaN(y) && heightAt(x, z) < 0.3) continue;
          const k = pNext;
          pNext = (pNext + 1) % SPLASH;
          pPos.setXYZ(k, x, Number.isNaN(y) ? surfaceAt(x, z) + 0.06 : y, z);
          pLife[k] = SPLASH_LIFE * (0.8 + rng() * 0.4);
        }
        let pAny = false;
        for (let k = 0; k < SPLASH; k++) {
          if (pLife[k] <= 0) {
            if (pAlpha.getX(k) !== 0) pAlpha.setX(k, 0);
            continue;
          }
          pAny = true;
          pLife[k] -= dt;
          pPhase.setX(k, Math.min(1, 1 - pLife[k] / SPLASH_LIFE));
          pAlpha.setX(k, pLife[k] > 0 ? 1 : 0);
        }
        pPos.needsUpdate = true;
        pPhase.needsUpdate = true;
        pAlpha.needsUpdate = true;
        splashes.visible = pAny || rainAmount > 0.01;
        splashMat.uniforms.uAmount.value = Math.min(1, rainAmount * 1.2);
      }
      dustMat.uniforms.uAmount.value = 1 - night;
      flyMat.uniforms.uAmount.value = Math.max(0, night - 0.3) / 0.7;
      poolMat.uniforms.uAmount.value = night * lamps;
      // 生気: 還る個体ごとに毎秒 VITALITY_RATE 粒を体の周りから出す
      for (const a of agents) {
        if (a.state !== 'return') {
          debt.delete(a.id);
          continue;
        }
        let d = (debt.get(a.id) ?? 0) + dt * VITALITY_RATE;
        while (d >= 1) {
          d -= 1;
          const k = next;
          next = (next + 1) % VITALITY;
          const r = Math.sqrt(rng()) * 0.7;
          const ang = rng() * Math.PI * 2;
          const x = a.x + Math.cos(ang) * r;
          const z = a.z + Math.sin(ang) * r;
          vPos.setXYZ(k, x, heightAt(x, z) + 0.1 + rng() * 0.4, z);
          vel[k * 3] = (rng() - 0.5) * 0.25;
          vel[k * 3 + 1] = 0.45 + rng() * 0.5;
          vel[k * 3 + 2] = (rng() - 0.5) * 0.25;
          life[k] = VITALITY_LIFE * (0.7 + rng() * 0.3);
        }
        debt.set(a.id, d);
      }
      let any = false;
      for (let k = 0; k < VITALITY; k++) {
        if (life[k] <= 0) {
          if (vAlpha.getX(k) !== 0) vAlpha.setX(k, 0);
          continue;
        }
        any = true;
        life[k] -= dt;
        const f = Math.max(0, life[k] / VITALITY_LIFE);
        // 立ちのぼりながら渦を巻き、上で薄れて消える
        up.set(vel[k * 3] + Math.sin(t * 2 + k) * 0.08, vel[k * 3 + 1], vel[k * 3 + 2] + Math.cos(t * 2 + k) * 0.08).multiplyScalar(dt);
        vPos.setXYZ(k, vPos.getX(k) + up.x, vPos.getY(k) + up.y, vPos.getZ(k) + up.z);
        vAlpha.setX(k, Math.min(1, (1 - f) * 5) * f);
      }
      if (any) {
        vPos.needsUpdate = true;
        vAlpha.needsUpdate = true;
      }
    },
    sprout(at, radiusM) {
      sQueue.push({ x: at.x, z: at.z, r: Math.max(4, Math.min(30, radiusM)), left: 2.4 });
      // (M22-07 の手直し) 地面の放射の光を植えた点に置き直す (粒の届く所まで)
      const R = Math.max(SPROUT_MIN_R, Math.max(4, Math.min(30, radiusM)) * SPROUT_SPREAD) * 1.35;
      burst.geometry.dispose();
      burst.geometry = drapedDisc(at.x, at.z, R, heightAt, 0.3);
      burstMat.uniforms.uR.value = R;
      (burstMat.uniforms.uCenter.value as Vector2).set(at.x, at.z);
      burstAge = 0;
      burstMat.uniforms.uAge.value = 0;
      burst.visible = true;
    },
    setLamps(amount) {
      lamps = amount;
    },
    setRain(amount) {
      rainMat.uniforms.uAmount.value = amount;
      rain.visible = amount > 0.01;
      // (M22-07 の手直し) 跳ね返りの数も雨の強さに比例させる
      rainAmount = amount;
    },
  };
}
