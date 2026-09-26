import { DepthTexture, HalfFloatType, ShaderMaterial, Vector2, WebGLRenderTarget, type PerspectiveCamera, type Scene, type WebGLRenderer } from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { createBloom } from './bloom';

/**
 * 絵画調の色調補正 (設計 §8)。暖色のハイライト・寒色の影 (split toning)、わずかな彩度、周辺減光、紙の粒。
 * 出どころの違うアセットを一枚の絵に揃えるのが役目なので、強さは控えめにして基準画 (key-visuals) に寄せる。
 */
// (M23-07 で変更: 最後の全画面の 1 パスにまとめた。場面の色に空気 (色 × T + L、半分の大きさの空気を深度を見て引き伸ばす) と bloom の 5 段を足し、
//  色調を掛け (USE_GRADE)、画面の色空間 (sRGB) にして画面へ書く (元の OutputPass の役目)。元は 空気・bloom の足し込み・色調・出力 が別々の全画面のパスだった)
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uWarm: { value: [1.06, 1.0, 0.9] },
    uCool: { value: [0.9, 0.97, 1.08] },
    uSaturation: { value: 1.08 },
    uVignette: { value: 0.28 },
    uGrain: { value: 0.025 },
    uResolution: { value: new Vector2(1, 1) },
    // (M23-07) 空気 (L と T)・深度・カメラの近い / 遠い切り捨て、bloom の 5 段と重み
    tDepth: { value: null },
    tAir: { value: null },
    uNearFar: { value: new Vector2(0.2, 2000) },
    tBloom0: { value: null },
    tBloom1: { value: null },
    tBloom2: { value: null },
    tBloom3: { value: null },
    tBloom4: { value: null },
    uBloomW: { value: [0, 0, 0, 0, 0] },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform vec3 uWarm;
    uniform vec3 uCool;
    uniform float uSaturation;
    uniform float uVignette;
    uniform float uGrain;
    uniform vec2 uResolution;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    #ifdef USE_AIR
    uniform sampler2D tDepth;
    uniform sampler2D tAir;
    uniform vec2 uNearFar;
    // 視線方向の距離 (空は遠い一定の値)
    float viewZ(float d) { return d >= 0.99999 ? 1e5 : uNearFar.x * uNearFar.y / (uNearFar.y - d * (uNearFar.y - uNearFar.x)); }
    // 空気の L と T。半分の大きさのとき、周りの 4 点を線形補間の重みと「その点が見た深度が自分の深度に近いか」で混ぜる
    // (木の輪郭と空の境で、空の濃い霞が木に滲まない)。どの点も遠いときは最も近い点を使う
    vec4 airAt() {
      ivec2 dsz = textureSize(tDepth, 0);
      vec2 sp = vUv * vec2(dsz);
      #if AIR_SCALE == 1
      return texelFetch(tAir, min(ivec2(sp), textureSize(tAir, 0) - 1), 0);
      #else
      ivec2 asz = textureSize(tAir, 0);
      float z = viewZ(texelFetch(tDepth, min(ivec2(sp), dsz - 1), 0).x);
      vec2 hp = sp / float(AIR_SCALE) - 0.5;
      ivec2 b = ivec2(floor(hp));
      vec2 f = hp - vec2(b);
      vec4 sum = vec4(0.0);
      float wsum = 0.0;
      vec4 best = vec4(0.0, 0.0, 0.0, 1.0);
      float bestRel = 1e9;
      for (int j = 0; j < 2; j++) {
        for (int i = 0; i < 2; i++) {
          ivec2 q = clamp(b + ivec2(i, j), ivec2(0), asz - 1);
          float zq = viewZ(texelFetch(tDepth, min(q * AIR_SCALE, dsz - 1), 0).x);
          vec4 a = texelFetch(tAir, q, 0);
          float rel = abs(z - zq) / min(z, zq);
          float w = (i == 0 ? 1.0 - f.x : f.x) * (j == 0 ? 1.0 - f.y : f.y) * exp(-rel * 16.0);
          sum += a * w;
          wsum += w;
          if (rel < bestRel) {
            bestRel = rel;
            best = a;
          }
        }
      }
      return wsum > 0.02 ? sum / wsum : best;
      #endif
    }
    #endif
    #ifdef USE_BLOOM
    uniform sampler2D tBloom0;
    uniform sampler2D tBloom1;
    uniform sampler2D tBloom2;
    uniform sampler2D tBloom3;
    uniform sampler2D tBloom4;
    uniform float uBloomW[5];
    #endif
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      #ifdef USE_AIR
      vec4 air = airAt();
      c.rgb = c.rgb * air.a + air.rgb;
      #endif
      #ifdef USE_BLOOM
      // UnrealBloomPass の合成と足し込み (bloom.ts の bloomWeights)
      c.rgb += uBloomW[0] * texture2D(tBloom0, vUv).rgb + uBloomW[1] * texture2D(tBloom1, vUv).rgb + uBloomW[2] * texture2D(tBloom2, vUv).rgb
        + uBloomW[3] * texture2D(tBloom3, vUv).rgb + uBloomW[4] * texture2D(tBloom4, vUv).rgb;
      #endif
      #ifdef USE_GRADE
      float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
      vec3 toned = c.rgb * mix(uCool, uWarm, smoothstep(0.2, 0.8, l));
      toned = mix(vec3(l), toned, uSaturation);
      vec2 d = vUv - 0.5;
      toned *= 1.0 - uVignette * smoothstep(0.35, 0.85, length(d * vec2(uResolution.x / uResolution.y, 1.0)));
      toned += (hash(floor(vUv * uResolution / 1.5) + uTime) - 0.5) * uGrain;
      gl_FragColor = vec4(toned, c.a);
      #else
      gl_FragColor = c;
      #endif
      #include <colorspace_fragment>
    }
  `,
};

export type Grade = {
  render(dt: number): void;
  setSize(w: number, h: number): void;
  setEnabled(o: { grade: boolean; bloom: boolean }): void;
  /** (M23-07) 合成の描画先の、画面の画素に対する倍率 (動的な解像度)。画面 (canvas) の大きさは変えず、最後の出力で引き伸ばす */
  setPixelRatio(r: number): void;
};

/**
 * (M23-07) 空気の層 (atmosphere.ts の AtmospherePass)。場面の描画先 source から色と深度を読み、描く先 (場面の scale 分の 1) に空気の L と T を書く
 */
export type AirLayer = {
  source: WebGLRenderTarget | null;
  readonly scale: 1 | 2;
  render(renderer: WebGLRenderer, writeBuffer: WebGLRenderTarget, readBuffer: WebGLRenderTarget): void;
};

/** air: 場面の描画のすぐ後 (bloom の前) に挟むパス。深度を読むので、合成の描画先に深度のテクスチャと MSAA を持たせる */
// (M23-07 で変更: EffectComposer をやめ、パスを自分で並べる: 影 → 場面 (MSAA・深度のテクスチャ) → 空気 (L と T、既定で半分の大きさ) → bloom の抜き出しとぼかし → 最後の 1 パス。
//  元は合成の描画先 (往復する 2 枚) の両方に 4× MSAA と深度を持たせ、空気・bloom・色調・出力の全画面のパスも MSAA の描画先へ書いて毎回解決していた。
//  msaa は場面の MSAA の段 (0 で切る)。air は 1 つだけ使う)
export function createGrade(renderer: WebGLRenderer, scene: Scene, camera: PerspectiveCamera, air: AirLayer[] = [], { msaa = 4 } = {}): Grade {
  const target = new WebGLRenderTarget(1, 1, { type: HalfFloatType, samples: msaa, depthTexture: new DepthTexture(1, 1) });
  const layer = air[0] ?? null;
  const airTarget = layer ? new WebGLRenderTarget(1, 1, { type: HalfFloatType, depthBuffer: false }) : null;
  if (layer) layer.source = target;
  // シアンの発光 (ムーの遺産の光) と鐘の灯りだけが滲むよう、閾値を高めにする
  const bloom = createBloom(0.4, 0.5, 0.92);
  const mat = new ShaderMaterial({ ...GradeShader, uniforms: GradeShader.uniforms, depthTest: false, depthWrite: false });
  const u = mat.uniforms;
  u.tDiffuse.value = target.texture;
  u.tDepth.value = target.depthTexture;
  u.tAir.value = airTarget?.texture ?? null;
  bloom.textures.forEach((tex, i) => (u[`tBloom${i}`].value = tex));
  u.uBloomW.value = bloom.weights;
  const quad = new FullScreenQuad(mat);
  let enabled = { grade: true, bloom: true };
  const applyDefines = () => {
    const defs: Record<string, string | number> = {};
    if (layer) {
      defs.USE_AIR = '';
      defs.AIR_SCALE = layer.scale;
    }
    if (enabled.bloom) defs.USE_BLOOM = '';
    if (enabled.grade) defs.USE_GRADE = '';
    mat.defines = defs;
    mat.needsUpdate = true;
  };
  applyDefines();
  let t = 0;
  let size = { w: 1, h: 1, r: renderer.getPixelRatio() };
  const resize = () => {
    const w = Math.max(1, Math.round(size.w * size.r));
    const h = Math.max(1, Math.round(size.h * size.r));
    target.setSize(w, h);
    if (layer && airTarget) airTarget.setSize(Math.ceil(w / layer.scale), Math.ceil(h / layer.scale));
    // bloom は画面 (CSS) の大きさで作る (元の UnrealBloomPass と同じ)。合成の倍率が 1 より下がったときはそれに合わせる
    bloom.setSize(size.w * Math.min(1, size.r), size.h * Math.min(1, size.r));
  };
  return {
    render(dt) {
      t += dt;
      u.uTime.value = Math.floor(t * 12);
      (u.uNearFar.value as Vector2).set(camera.near, camera.far);
      renderer.setRenderTarget(target);
      renderer.render(scene, camera);
      if (layer && airTarget) layer.render(renderer, airTarget, target);
      if (enabled.bloom) bloom.render(renderer, target.texture, airTarget?.texture ?? null);
      renderer.setRenderTarget(null);
      quad.render(renderer);
    },
    setSize(w, h) {
      size = { ...size, w, h };
      resize();
      (u.uResolution.value as Vector2).set(w, h);
    },
    setEnabled(o) {
      enabled = { ...o };
      applyDefines();
    },
    setPixelRatio(r) {
      if (r === size.r) return;
      size = { ...size, r };
      resize();
    },
  };
}
