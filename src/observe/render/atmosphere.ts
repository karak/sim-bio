import {
  BackSide,
  Color,
  Matrix4,
  Mesh,
  ShaderMaterial,
  SphereGeometry,
  Vector2,
  Vector3,
  type DirectionalLight,
  type PerspectiveCamera,
  type Texture,
  type WebGLRenderer,
  type WebGLRenderTarget,
} from 'three';
import { FullScreenQuad, Pass } from 'three/addons/postprocessing/Pass.js';
import type { Daylight } from '../daylight';

/**
 * 空気感 (M22-07、基準画 key-visuals/herd の「林に差す光の筋・奥が青く霞む空気・地を這う靄」)。
 * - 空: 天頂と地平のグラデーション、日の暈、夜は月と星。深度を書かない球なので、後段では深度 1 = 空として扱う。
 * - 空気の層 (後段のパス): 深度から位置を戻し、高さで薄くなる霞 (解析式)、地を這う靄 (雑音で揺らぐ)、
 *   日の方向ほど暖かく光る散乱、日の影の地図を視線に沿って数え、林の隙間から差す光の筋 (体積光) を足す。
 * 霞と靄は Three.js の Fog の代わり (両方かけると二重に白む)。
 */

const SkyShader = {
  uniforms: {
    uZenith: { value: new Color() },
    uHorizon: { value: new Color() },
    uLightDir: { value: new Vector3(0, 1, 0) },
    uLightColor: { value: new Color() },
    uNight: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec3 vDir;
    void main() {
      vDir = normalize(position);
      vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      gl_Position = p.xyww;
    }
  `,
  fragmentShader: /* glsl */ `
    uniform vec3 uZenith;
    uniform vec3 uHorizon;
    uniform vec3 uLightDir;
    uniform vec3 uLightColor;
    uniform float uNight;
    varying vec3 vDir;
    float hash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
    void main() {
      vec3 d = normalize(vDir);
      float h = clamp(d.y, -0.2, 1.0);
      vec3 c = mix(uHorizon, uZenith, pow(smoothstep(-0.02, 0.5, h), 0.8));
      float mu = max(dot(d, uLightDir), 0.0);
      // 昼は日の暈を広く、夜は月の輪郭をくっきり
      float disc = smoothstep(mix(0.9994, 0.99965, uNight), mix(0.9997, 0.9999, uNight), mu);
      c += uLightColor * (pow(mu, 12.0) * mix(0.35, 0.12, uNight) + disc * mix(1.6, 1.2, uNight));
      // 星 (夜だけ、地平近くは霞で消える)
      vec3 g = floor(d * 380.0);
      float st = step(0.9975, hash(g)) * smoothstep(0.05, 0.4, d.y) * uNight;
      c += vec3(0.85, 0.9, 1.0) * st * (0.6 + 0.4 * hash(g + 3.1));
      gl_FragColor = vec4(c, 1.0);
      #include <colorspace_fragment>
    }
  `,
};

export type Sky = { mesh: Mesh; update(day: Daylight, camera: PerspectiveCamera): void };

export function createSky(): Sky {
  const mat = new ShaderMaterial({ ...SkyShader, uniforms: SkyShader.uniforms, side: BackSide, depthWrite: false, fog: false });
  const mesh = new Mesh(new SphereGeometry(600, 32, 16), mat);
  mesh.renderOrder = -1;
  mesh.frustumCulled = false;
  mesh.name = 'observe-sky';
  const u = mat.uniforms;
  return {
    mesh,
    update(day, camera) {
      mesh.position.copy(camera.position);
      (u.uZenith.value as Color).set(day.zenith);
      (u.uHorizon.value as Color).set(day.horizon);
      (u.uLightDir.value as Vector3).set(day.lightDir.x, day.lightDir.y, day.lightDir.z);
      (u.uLightColor.value as Color).set(day.lightColor);
      u.uNight.value = day.night;
    },
  };
}

const AirShader = {
  uniforms: {
    tDiffuse: { value: null as Texture | null },
    tDepth: { value: null as Texture | null },
    tShadow: { value: null as Texture | null },
    uUseShadow: { value: 0 },
    uInvProj: { value: new Matrix4() },
    uCamWorld: { value: new Matrix4() },
    uCamPos: { value: new Vector3() },
    uShadowMatrix: { value: new Matrix4() },
    uLightDir: { value: new Vector3(0, 1, 0) },
    uLightColor: { value: new Color() },
    uFogColor: { value: new Color() },
    uHaze: { value: 0.0035 },
    uFogHeight: { value: 0 },
    uFalloff: { value: 0.06 },
    uMist: { value: 0.6 },
    uShafts: { value: 1 },
    uTime: { value: 0 },
    uResolution: { value: new Vector2(1, 1) },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform sampler2D tDepth;
    uniform sampler2DShadow tShadow;
    uniform float uUseShadow;
    uniform mat4 uInvProj;
    uniform mat4 uCamWorld;
    uniform vec3 uCamPos;
    uniform mat4 uShadowMatrix;
    uniform vec3 uLightDir;
    uniform vec3 uLightColor;
    uniform vec3 uFogColor;
    uniform float uHaze;
    uniform float uFogHeight;
    uniform float uFalloff;
    uniform float uMist;
    uniform float uShafts;
    uniform float uTime;
    varying vec2 vUv;

    float vnoise(vec2 p) {
      vec2 i = floor(p);
      vec2 f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      float a = fract(sin(dot(i, vec2(127.1, 311.7))) * 43758.5453);
      float b = fract(sin(dot(i + vec2(1.0, 0.0), vec2(127.1, 311.7))) * 43758.5453);
      float c = fract(sin(dot(i + vec2(0.0, 1.0), vec2(127.1, 311.7))) * 43758.5453);
      float d = fract(sin(dot(i + vec2(1.0, 1.0), vec2(127.1, 311.7))) * 43758.5453);
      return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
    }
    float fbm(vec2 p) { return 0.55 * vnoise(p) + 0.3 * vnoise(p * 2.1 + 3.7) + 0.15 * vnoise(p * 4.3 + 9.1); }
    // 光の筋の数え始めをずらす (段の縞を消す)。画面に固定した雑音なので時間でちらつかない
    float ign(vec2 px) { return fract(52.9829189 * fract(dot(px, vec2(0.06711056, 0.00583715)))); }

    void main() {
      vec4 col = texture2D(tDiffuse, vUv);
      float depth = texture2D(tDepth, vUv).x;
      bool sky = depth >= 0.99999;
      vec4 vp = uInvProj * vec4(vUv * 2.0 - 1.0, (sky ? 0.9999 : depth) * 2.0 - 1.0, 1.0);
      vec3 wp = (uCamWorld * vec4(vp.xyz / vp.w, 1.0)).xyz;
      vec3 ray = wp - uCamPos;
      // 空は水面の果て (1.5 km) より遠いものとして霞ませ、水平線で海と空が同じ空気の色に溶けるようにする
      float dist = sky ? 3000.0 : length(ray);
      vec3 rd = normalize(ray);

      // 高さで薄くなる霞 (高さ uFogHeight で濃さ uHaze、uFalloff で指数に薄れる) を視線に沿って積分した量
      float k = rd.y * uFalloff;
      float base = uHaze * exp(-(uCamPos.y - uFogHeight) * uFalloff);
      float fogAmt = abs(k) > 1e-4 ? base * (1.0 - exp(-dist * k)) / k : base * dist;
      // 地を這う靄: 当たった所の低さと雑音で濃くし、ゆっくり流す (空には掛けない)
      if (!sky) {
        float n = fbm(wp.xz * 0.03 + vec2(uTime * 0.011, uTime * 0.004));
        float low = exp(-max(wp.y - uFogHeight - 1.0, 0.0) * 0.12);
        // 手前 15 m は澄ませ、奥の木々のあいだに溜まる靄にする (基準画 herd の奥の青い空気)
        fogAmt += uMist * smoothstep(0.35, 0.8, n) * low * smoothstep(15.0, 60.0, dist) * min(dist, 70.0) * 0.01;
      }
      float T = exp(-fogAmt);
      float mu = dot(rd, uLightDir);
      vec3 air = mix(uFogColor, uLightColor, pow(max(mu, 0.0), 6.0) * 0.5);
      vec3 outc = col.rgb * T + air * (1.0 - T);

      // 光の筋: 視線に沿って 24 点で日の影の地図を引き、日の当たる空気だけ前方散乱で光らせる
      if (uUseShadow > 0.5 && uShafts > 0.0) {
        float maxD = min(dist, 90.0);
        float stepL = maxD / 24.0;
        float j = ign(gl_FragCoord.xy);
        float lit = 0.0;
        for (int i = 0; i < 24; i++) {
          vec3 p = uCamPos + rd * ((float(i) + j) * stepL);
          vec4 sc = uShadowMatrix * vec4(p, 1.0);
          vec3 c = sc.xyz / sc.w;
          float l = (c.x < 0.0 || c.x > 1.0 || c.y < 0.0 || c.y > 1.0 || c.z > 1.0) ? 1.0 : texture(tShadow, vec3(c.xy, c.z));
          // 光の筋を見せる空気は目の高さの少し上までに溜める (上空まで数えると日の方向の空が白く飛び、林の下の筋が埋もれる)
          lit += l * exp(-max(p.y - uCamPos.y - 2.0, 0.0) * 0.18);
        }
        lit /= 24.0;
        float g = 0.6;
        float hg = (1.0 - g * g) / pow(1.0 + g * g - 2.0 * g * mu, 1.5) / 12.566;
        outc += uLightColor * lit * hg * uShafts * (1.0 - exp(-maxD * 0.025)) * (sky ? 0.8 : 2.4);
      }
      gl_FragColor = vec4(outc, col.a);
    }
  `,
};

export class AtmospherePass extends Pass {
  private readonly quad: FullScreenQuad;
  readonly mat: ShaderMaterial;
  constructor(
    private readonly camera: PerspectiveCamera,
    private readonly light: DirectionalLight,
  ) {
    super();
    this.mat = new ShaderMaterial({ uniforms: AirShader.uniforms, vertexShader: AirShader.vertexShader, fragmentShader: AirShader.fragmentShader, depthTest: false, depthWrite: false });
    this.quad = new FullScreenQuad(this.mat);
  }

  setDay(day: Daylight, t: number): void {
    const u = this.mat.uniforms;
    (u.uLightDir.value as Vector3).set(day.lightDir.x, day.lightDir.y, day.lightDir.z);
    (u.uLightColor.value as Color).set(day.lightColor).multiplyScalar(Math.min(1.2, day.lightIntensity / 2));
    (u.uFogColor.value as Color).set(day.fog);
    u.uHaze.value = 0.0035 * day.haze;
    u.uShafts.value = day.shafts;
    u.uTime.value = t;
  }

  render(renderer: WebGLRenderer, writeBuffer: WebGLRenderTarget, readBuffer: WebGLRenderTarget): void {
    const u = this.mat.uniforms;
    u.tDiffuse.value = readBuffer.texture;
    u.tDepth.value = readBuffer.depthTexture;
    const sm = this.light.castShadow ? this.light.shadow.map?.depthTexture : null;
    u.tShadow.value = sm ?? null;
    u.uUseShadow.value = sm ? 1 : 0;
    (u.uInvProj.value as Matrix4).copy(this.camera.projectionMatrixInverse);
    (u.uCamWorld.value as Matrix4).copy(this.camera.matrixWorld);
    (u.uCamPos.value as Vector3).setFromMatrixPosition(this.camera.matrixWorld);
    (u.uShadowMatrix.value as Matrix4).copy(this.light.shadow.matrix);
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
  }

  dispose(): void {
    this.mat.dispose();
    this.quad.dispose();
  }
}
