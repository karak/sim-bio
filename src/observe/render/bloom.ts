import { HalfFloatType, ShaderMaterial, Vector2, WebGLRenderTarget, type Texture, type WebGLRenderer } from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

/**
 * 光の滲み (M23-07、docs/design/2026-09-24-observe-perf.md)。three.js の UnrealBloomPass と同じ計算を、段を減らして行う。
 * UnrealBloomPass は 明るい所の抜き出し → 5 段のぼかし (横・縦) → 5 段を足す合成 → 全画面への足し込み の 13 パスで、
 * 2560×1440 で切ると 5 ms 軽くなった (この GPU では小さなパスも 1 つ 0.15 ms ほど掛かり、全画面のパスは 0.75 ms ほど)。
 * ここでは抜き出しとぼかしの 11 パスだけを描き、5 段を足す合成と足し込みは色調のパス (grade.ts) が全画面の 1 パスの中で行う。
 * 抜き出しは空気の層を掛けた色で行う (元の順: 空気 → bloom)。空気は色調のパスで掛けるので、ここでは場面の色 × T + L をその場で作る。
 */

/** UnrealBloomPass の段ごとのぼかしの半径 (その段の画素) */
export const BLOOM_KERNELS = [6, 10, 14, 18, 22] as const;
/** UnrealBloomPass の段ごとの重み (bloomFactors) */
const BLOOM_FACTORS = [1.0, 0.8, 0.6, 0.4, 0.2] as const;

/** UnrealBloomPass._getSeparableBlurMaterial と同じ係数 (σ = 半径 / 3、隣り合う 2 点を 1 回の線形補間の読みにまとめる) */
export function blurTaps(kernelRadius: number): { center: number; offsets: number[]; weights: number[] } {
  const sigma = kernelRadius / 3;
  const c: number[] = [];
  for (let i = 0; i < kernelRadius; i++) c.push((0.39894 * Math.exp((-0.5 * i * i) / (sigma * sigma))) / sigma);
  const offsets: number[] = [];
  const weights: number[] = [];
  for (let i = 1; i < kernelRadius; i += 2) {
    const wa = c[i];
    const wb = i + 1 < kernelRadius ? c[i + 1] : 0;
    offsets.push((i * wa + (i + 1) * wb) / (wa + wb));
    weights.push(wa + wb);
  }
  return { center: c[0], offsets, weights };
}

/**
 * 5 段を足す重み (UnrealBloomPass の合成: 3.0 × strength × mix(factor, 1.2 − factor, radius))。
 * 足し込みは premultipliedAlpha の AdditiveBlending (ONE, ONE) なので、合成した色をそのまま足す
 */
export function bloomWeights(strength: number, radius: number): number[] {
  return BLOOM_FACTORS.map((f) => 3.0 * strength * (f + (1.2 - 2 * f) * radius));
}

/** 段 i の大きさ (UnrealBloomPass.setSize と同じ: 最初は半分、以降は半分ずつ。Math.round) */
export function bloomSizes(width: number, height: number): { w: number; h: number }[] {
  const out: { w: number; h: number }[] = [];
  let w = Math.round(width / 2);
  let h = Math.round(height / 2);
  for (let i = 0; i < BLOOM_KERNELS.length; i++) {
    out.push({ w: Math.max(1, w), h: Math.max(1, h) });
    w = Math.round(w / 2);
    h = Math.round(h / 2);
  }
  return out;
}

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;

export type Bloom = {
  /** 5 段のぼかした絵 (色調のパスが読む) */
  readonly textures: Texture[];
  /** 5 段を足す重み */
  readonly weights: number[];
  /** width・height は UnrealBloomPass の setSize に渡していた大きさ (CSS の画素) */
  setSize(width: number, height: number): void;
  /** scene: 場面の色、air: 空気の L と T (無ければ null) */
  render(renderer: WebGLRenderer, scene: Texture, air: Texture | null): void;
  dispose(): void;
};

export function createBloom(strength: number, radius: number, threshold: number): Bloom {
  const target = () => {
    const t = new WebGLRenderTarget(1, 1, { type: HalfFloatType, depthBuffer: false });
    t.texture.generateMipmaps = false;
    return t;
  };
  const bright = target();
  const horizontal = BLOOM_KERNELS.map(target);
  const vertical = BLOOM_KERNELS.map(target);
  // 明るい所の抜き出し (UnrealBloomPass の LuminosityHighPassShader と同じ smoothstep、幅 0.01)
  const extract = new ShaderMaterial({
    defines: {},
    uniforms: { tScene: { value: null }, tAir: { value: null }, uThreshold: { value: threshold }, uSmoothWidth: { value: 0.01 } },
    vertexShader,
    fragmentShader: /* glsl */ `
      uniform sampler2D tScene;
      uniform sampler2D tAir;
      uniform float uThreshold;
      uniform float uSmoothWidth;
      varying vec2 vUv;
      void main() {
        vec3 c = texture2D(tScene, vUv).rgb;
        #ifdef USE_AIR
        vec4 a = texture2D(tAir, vUv);
        c = c * a.a + a.rgb;
        #endif
        float v = dot(c, vec3(0.2126, 0.7152, 0.0722));
        gl_FragColor = vec4(c * smoothstep(uThreshold, uThreshold + uSmoothWidth, v), 1.0);
      }
    `,
    depthTest: false,
    depthWrite: false,
  });
  const blurs = BLOOM_KERNELS.map((k) => {
    const t = blurTaps(k);
    return new ShaderMaterial({
      defines: { KERNEL_PAIRS: t.offsets.length },
      uniforms: {
        colorTexture: { value: null },
        invSize: { value: new Vector2(1, 1) },
        direction: { value: new Vector2(1, 0) },
        centerWeight: { value: t.center },
        gaussianOffsets: { value: t.offsets },
        gaussianWeights: { value: t.weights },
      },
      vertexShader,
      fragmentShader: /* glsl */ `
        uniform sampler2D colorTexture;
        uniform vec2 invSize;
        uniform vec2 direction;
        uniform float centerWeight;
        uniform float gaussianOffsets[KERNEL_PAIRS];
        uniform float gaussianWeights[KERNEL_PAIRS];
        varying vec2 vUv;
        void main() {
          vec3 sum = texture2D(colorTexture, vUv).rgb * centerWeight;
          for (int i = 0; i < KERNEL_PAIRS; i++) {
            vec2 o = direction * invSize * gaussianOffsets[i];
            sum += (texture2D(colorTexture, vUv + o).rgb + texture2D(colorTexture, vUv - o).rgb) * gaussianWeights[i];
          }
          gl_FragColor = vec4(sum, 1.0);
        }
      `,
      depthTest: false,
      depthWrite: false,
    });
  });
  const quad = new FullScreenQuad(extract);
  let useAir: boolean | null = null;
  return {
    textures: vertical.map((t) => t.texture),
    weights: bloomWeights(strength, radius),
    setSize(width, height) {
      const sizes = bloomSizes(width, height);
      bright.setSize(sizes[0].w, sizes[0].h);
      sizes.forEach((s, i) => {
        horizontal[i].setSize(s.w, s.h);
        vertical[i].setSize(s.w, s.h);
        (blurs[i].uniforms.invSize.value as Vector2).set(1 / s.w, 1 / s.h);
      });
    },
    render(renderer, scene, air) {
      if (useAir !== !!air) {
        useAir = !!air;
        if (air) extract.defines.USE_AIR = '';
        else delete extract.defines.USE_AIR;
        extract.needsUpdate = true;
      }
      extract.uniforms.tScene.value = scene;
      extract.uniforms.tAir.value = air;
      quad.material = extract;
      renderer.setRenderTarget(bright);
      quad.render(renderer);
      let input = bright;
      for (let i = 0; i < blurs.length; i++) {
        const m = blurs[i];
        quad.material = m;
        m.uniforms.colorTexture.value = input.texture;
        (m.uniforms.direction.value as Vector2).set(1, 0);
        renderer.setRenderTarget(horizontal[i]);
        quad.render(renderer);
        m.uniforms.colorTexture.value = horizontal[i].texture;
        (m.uniforms.direction.value as Vector2).set(0, 1);
        renderer.setRenderTarget(vertical[i]);
        quad.render(renderer);
        input = vertical[i];
      }
    },
    dispose() {
      for (const t of [bright, ...horizontal, ...vertical]) t.dispose();
      for (const m of [extract, ...blurs]) m.dispose();
      quad.dispose();
    },
  };
}
