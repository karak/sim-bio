import { Vector2, type Camera, type Scene, type WebGLRenderer } from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

/**
 * 絵画調の色調補正 (設計 §8)。暖色のハイライト・寒色の影 (split toning)、わずかな彩度、周辺減光、紙の粒。
 * 出どころの違うアセットを一枚の絵に揃えるのが役目なので、強さは控えめにして基準画 (key-visuals) に寄せる。
 */
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
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
      vec3 toned = c.rgb * mix(uCool, uWarm, smoothstep(0.2, 0.8, l));
      toned = mix(vec3(l), toned, uSaturation);
      vec2 d = vUv - 0.5;
      toned *= 1.0 - uVignette * smoothstep(0.35, 0.85, length(d * vec2(uResolution.x / uResolution.y, 1.0)));
      toned += (hash(floor(vUv * uResolution / 1.5) + uTime) - 0.5) * uGrain;
      gl_FragColor = vec4(toned, c.a);
    }
  `,
};

export type Grade = { render(dt: number): void; setSize(w: number, h: number): void; setEnabled(o: { grade: boolean; bloom: boolean }): void };

export function createGrade(renderer: WebGLRenderer, scene: Scene, camera: Camera): Grade {
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  // シアンの発光 (ムーの遺産の光) と鐘の灯りだけが滲むよう、閾値を高めにする
  const bloom = new UnrealBloomPass(new Vector2(1, 1), 0.55, 0.6, 0.92);
  composer.addPass(bloom);
  const grade = new ShaderPass(GradeShader);
  composer.addPass(grade);
  composer.addPass(new OutputPass());
  let t = 0;
  return {
    render(dt) {
      t += dt;
      grade.uniforms.uTime.value = Math.floor(t * 12);
      composer.render(dt);
    },
    setSize(w, h) {
      composer.setSize(w, h);
      bloom.setSize(w, h);
      (grade.uniforms.uResolution.value as Vector2).set(w, h);
    },
    setEnabled({ grade: g, bloom: b }) {
      grade.enabled = g;
      bloom.enabled = b;
    },
  };
}
