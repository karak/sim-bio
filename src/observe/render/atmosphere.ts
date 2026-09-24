import {
  BackSide,
  Color,
  Matrix4,
  Mesh,
  ShaderMaterial,
  SphereGeometry,
  Vector2,
  Vector3,
  Vector4,
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
    uSunUv: { value: new Vector2(0.5, 0.5) },
    uSunVis: { value: 0 },
    uMistAt: { value: new Vector4(0, 0, 0, 1) },
    uMistAmt: { value: 0 },
    uMistColor: { value: new Color('#8C8298') },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform sampler2D tDepth;
    // (M23-07 で変更: 影の地図が無いとき (?shadow=0) は sampler2DShadow を宣言しない。深度でない空のテクスチャが結ばれて描画が落ち、画面が黒くなっていた)
    #ifdef AIR_SHADOW
    uniform sampler2DShadow tShadow;
    #endif
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
    uniform vec2 uSunUv;
    uniform float uSunVis;
    uniform vec4 uMistAt;
    uniform float uMistAmt;
    uniform vec3 uMistColor;
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
      // (M23-07 で変更: 場面の色は読まず、空気が足す光 L と透過率 T を書く (色調のパスで 色 × T + L)。
      //  空気は場面の AIR_SCALE 分の 1 の大きさで描き、深度は受け持つ画素の組の左上の 1 画素を読む (色調のパスの深度を見た引き伸ばしと同じ画素))
      ivec2 dpx = min(ivec2(gl_FragCoord.xy) * AIR_SCALE, textureSize(tDepth, 0) - 1);
      vec2 dUv = (vec2(dpx) + 0.5) / vec2(textureSize(tDepth, 0));
      float depth = texelFetch(tDepth, dpx, 0).x;
      bool sky = depth >= 0.99999;
      vec4 vp = uInvProj * vec4(dUv * 2.0 - 1.0, (sky ? 0.9999 : depth) * 2.0 - 1.0, 1.0);
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
      vec3 outc = air * (1.0 - T);
      float Tt = T;

      // 光の筋: 視線に沿って 24 点で日の影の地図を引き、日の当たる空気だけ前方散乱で光らせる
      #ifdef AIR_SHADOW
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
      #endif
      // 疫病の霧 (M22-08、sheets/effects の 2): 地を這う平たい楕円体の中を視線が通る長さだけ、紫がかった灰の霧を掛け、渦を巻かせる
      if (uMistAmt > 0.0) {
        vec3 sc = vec3(uMistAt.w, uMistAt.w * 0.22, uMistAt.w);
        vec3 o = (uCamPos - uMistAt.xyz) / sc;
        vec3 dd = rd / sc;
        float a = dot(dd, dd);
        float b = dot(o, dd);
        float c = dot(o, o) - 1.0;
        float disc = b * b - a * c;
        if (disc > 0.0) {
          float sq = sqrt(disc);
          float t0 = max((-b - sq) / a, 0.0);
          float t1 = min((-b + sq) / a, dist);
          if (t1 > t0) {
            // 楕円体の中を 8 点で数える。渦の筋は高い周波数の雑音を尖らせて作り、地面から離れるほど薄くする
            float seg = (t1 - t0) / 8.0;
            float m = 0.0;
            vec2 flow = vec2(sin(uTime * 0.13), cos(uTime * 0.09)) * 3.0 + uTime * vec2(0.05, 0.02);
            for (int i = 0; i < 8; i++) {
              vec3 p = uCamPos + rd * (t0 + (float(i) + 0.5) * seg);
              vec2 q = p.xz - uMistAt.xz;
              float ang = atan(q.y, q.x) + length(q) * 0.05 - uTime * 0.04;
              float swirl = fbm(vec2(ang * 2.5, length(q) * 0.12) + flow);
              float band = smoothstep(0.38, 0.72, swirl);
              float low = exp(-max(p.y - uMistAt.y, 0.0) * 0.3);
              m += band * low * seg;
            }
            float Tm = exp(-m * 0.22 * uMistAmt);
            outc = outc * Tm + uMistColor * (1.0 - Tm);
            Tt *= Tm;
          }
        }
      }
      // 光芒 (M22-07、試作 2 の判断「光の筋があるとさらによい」): 日の画面上の位置へ向かって深度を辿り、空が見える所を数える。
      // 木の輪郭と樹冠の隙間から日の方へ放射状に伸びる筋になる (上の体積光は奥行きの明るさ、こちらは絵としての筋)
      if (uSunVis > 0.0) {
        vec2 delta = (dUv - uSunUv) * (0.9 / 48.0);
        vec2 uv = dUv;
        float illum = 1.0;
        float rays = 0.0;
        float j2 = ign(gl_FragCoord.xy + 7.0);
        uv -= delta * j2 * 0.5;
        for (int i = 0; i < 48; i++) {
          uv -= delta;
          if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) break;
          rays += step(0.99999, texture2D(tDepth, uv).x) * illum;
          illum *= 0.965;
        }
        outc += uLightColor * rays * (1.0 / 48.0) * uSunVis * uShafts * 0.9;
      }
      gl_FragColor = vec4(outc, Tt);
    }
  `,
};

export class AtmospherePass extends Pass {
  private readonly quad: FullScreenQuad;
  readonly mat: ShaderMaterial;
  private readonly sunDir = new Vector3();
  private readonly fwd = new Vector3();
  private readonly sunPos = new Vector3();
  /** (M23-07) 場面の色と深度を読む描画先 (grade.ts の ScenePass が渡す)。無ければ前のパスの描画先を読む */
  source: WebGLRenderTarget | null = null;
  // (M23-07 で変更: scale は場面に対して何分の 1 の大きさで描くか (1 か 2)。描く先の大きさは grade.ts が決める)
  constructor(
    private readonly camera: PerspectiveCamera,
    private readonly light: DirectionalLight,
    readonly scale: 1 | 2 = 2,
  ) {
    super();
    this.mat = new ShaderMaterial({ uniforms: AirShader.uniforms, vertexShader: AirShader.vertexShader, fragmentShader: AirShader.fragmentShader, depthTest: false, depthWrite: false, defines: { AIR_SCALE: scale } });
    this.quad = new FullScreenQuad(this.mat);
  }

  /** 疫病の霧の中心 (m) と半径 (m)、濃さ (0 で消える) */
  setMist(at: { x: number; y: number; z: number }, radiusM: number, amount: number): void {
    (this.mat.uniforms.uMistAt.value as Vector4).set(at.x, at.y, at.z, radiusM);
    this.mat.uniforms.uMistAmt.value = amount;
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
    // (M23-07 で変更: 場面の描画先 source があればそこから読む)
    const src = this.source ?? readBuffer;
    u.tDiffuse.value = src.texture;
    u.tDepth.value = src.depthTexture;
    const sm = this.light.castShadow ? this.light.shadow.map?.depthTexture : null;
    u.tShadow.value = sm ?? null;
    u.uUseShadow.value = sm ? 1 : 0;
    // (M23-07) 影の地図の有る無しで、光の筋 (影の地図を引く) を組み込むかを切り替える
    if (!!sm !== !!this.mat.defines.AIR_SHADOW) {
      if (sm) this.mat.defines.AIR_SHADOW = true;
      else delete this.mat.defines.AIR_SHADOW;
      this.mat.needsUpdate = true;
    }
    (u.uInvProj.value as Matrix4).copy(this.camera.projectionMatrixInverse);
    (u.uCamWorld.value as Matrix4).copy(this.camera.matrixWorld);
    (u.uCamPos.value as Vector3).setFromMatrixPosition(this.camera.matrixWorld);
    (u.uShadowMatrix.value as Matrix4).copy(this.light.shadow.matrix);
    // 日の画面上の位置。カメラの後ろ・画面から大きく外れた日は光芒を消す
    // (日は画面の上に外れることが多い。上から林の隙間を下りる筋が見えるよう、画面の外 2.5 画面ぶんまでは残す)
    const toSun = this.sunDir.copy(u.uLightDir.value as Vector3);
    const fwd = this.camera.getWorldDirection(this.fwd);
    const facing = fwd.dot(toSun);
    this.sunPos.copy(this.camera.position).addScaledVector(toSun, 1000).project(this.camera);
    (u.uSunUv.value as Vector2).set(this.sunPos.x * 0.5 + 0.5, this.sunPos.y * 0.5 + 0.5);
    const off = Math.max(Math.abs(this.sunPos.x), Math.abs(this.sunPos.y));
    u.uSunVis.value = facing <= 0 ? 0 : Math.min(1, facing * 1.6) * (1 - Math.min(1, Math.max(0, (off - 1) / 2.5)));
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
  }

  dispose(): void {
    this.mat.dispose();
    this.quad.dispose();
  }
}
