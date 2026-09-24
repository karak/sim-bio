import {
  BackSide,
  Color,
  DataTexture,
  LinearFilter,
  RedFormat,
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
import { MIST_SPIN } from '../fx';

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
    // (M22-07 の手直し) 霧が消えていく段 (0〜1、fx.ts の mistEnvelope)
    uMistFade: { value: 0 },
    // (M22-07 の 3 回目) 霧の下の地面の高さの表 (霧を地形に沿わせる)。xy は表の西・北の端 (m)、z は一辺 (m)。H は高さの下限と幅 (m)
    tMistGround: { value: null as Texture | null },
    uMistGround: { value: new Vector4(0, 0, 1, 0) },
    uMistGroundH: { value: new Vector2(0, 0) },
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
    uniform float uMistFade;
    uniform sampler2D tMistGround;
    uniform vec4 uMistGround;
    uniform vec2 uMistGroundH;
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
    // (M22-07 の 3 回目、疫病の霧「螺旋の動きがみえない。」) 渦の濃さ (0〜1)。q は霧の中心からの水平の位置 (m)、R は半径 (m)、spin は回った角度 (rad)、mf は余韻。
    // 3 本の対数らせんの腕を尖らせて腕の間を澄ませ、雑音は腕と一緒に回して縁を崩すだけにする。
    // 前は腕の位相の進み (uTime * 0.5) と回転 (3 × 0.16 + 3 × 0.04) がほぼ打ち消し合い、腕は 1 秒に 2° ほどしか回っていなかった
    // (M22-07 の 3 回目) 腕の回る速さ (rad/s)・層の厚み (m)・地面の膜の厚み (m)・濃さの係数 (前は 0.22)
    const float MIST_SPIN = ${MIST_SPIN.toFixed(3)};
    const float MIST_LAYER = 2.5;
    const float MIST_SHEET = 2.5;
    const float MIST_K = 0.22;
    // (M22-07 の 3 回目) 霧の下の地面の高さ (m)。表の外は縁の値
    float mistGroundAt(vec2 xz) { return uMistGroundH.x + texture2D(tMistGround, (xz - uMistGround.xy) / uMistGround.z).r * uMistGroundH.y; }
    vec2 mistFlow(float t) { return vec2(sin(t * 0.13), cos(t * 0.09)) * 3.0 + t * vec2(0.05, 0.02); }
    float mistDensity(vec2 q, float R, float spin, float mf, vec2 flow) {
      float cs = cos(spin);
      float sn = sin(spin);
      vec2 qr = vec2(cs * q.x + sn * q.y, -sn * q.x + cs * q.y);
      float r = length(q) / R;
      float n = fbm(qr * 0.12 + flow);
      float ph = 3.0 * atan(qr.y, qr.x) + 7.0 * log(r + 0.05) + (n - 0.5) * 2.0;
      float arm = pow(0.5 + 0.5 * cos(ph), 2.0);
      float core = exp(-r * r * 45.0);
      float d = max(arm, core) * (0.35 + 1.3 * n);
      // 余韻では腕が細い筋に千切れる (閾値を上げる)
      d = smoothstep(0.12 + 0.34 * mf, 0.7 + 0.12 * mf, d);
      return d * smoothstep(1.0, 0.8, r);
    }

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
        // (M22-07 の手直し、「渦巻きの動き」「消えるところの余韻」): 余韻 (uMistFade) の間は楕円体を広げて少し持ち上げ、薄く散らす
        float mf = uMistFade;
        float m = 0.0;
        vec3 sc = vec3(uMistAt.w * (1.0 + 0.35 * mf), uMistAt.w * (0.22 + 0.2 * mf), uMistAt.w * (1.0 + 0.35 * mf));
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
            // (M22-07 の 3 回目で変更: 8 点は楕円体のうち地を這う層 (霧の下の最も高い地面から MIST_LAYER m、余韻で 2.5 m 持ち上がる) の中だけに置き、
            //  濃さは点の真下の地面からの高さで薄める (地形に沿う)。
            //  見下ろしたとき視線が層を横切る短い区間に点が集まり、腕の輪郭が視線に沿ってぼけない)
            float yTop = uMistGroundH.x + uMistGroundH.y + MIST_LAYER + 2.5 * mf;
            float l0 = t0;
            float l1 = t1;
            if (rd.y < -1e-4) l0 = max(l0, (yTop - uCamPos.y) / rd.y);
            else if (rd.y > 1e-4) l1 = min(l1, (yTop - uCamPos.y) / rd.y);
            else if (uCamPos.y > yTop) l1 = l0;
            float seg = max(l1 - l0, 0.0) / 8.0;
            vec2 flow = mistFlow(uTime);
            // (M22-07 の手直しで変更: 渦は、中心の周りを回る 3 本の対数らせんの腕と、同じ速さで回る雑音で作る。
            //  回転は剛体の回転 (半径で速さを変えない) なので時間が経っても巻き込みすぎず、腕の位相を進めて中心へ巻き込むように見せる。
            //  雑音の数は前と同じ (1 点 1 回の fbm)、足したのは回転と log・cos だけ)
            // (M22-07 の 3 回目で変更: 腕ごと 1 秒に MIST_SPIN (−0.42 rad、24°) 回す。2〜3 秒で 50〜70° 回り、見ていて回っているのが分かる。
            //  符号は腕が外から中心へ吸い込まれて見える向き。雑音は mistDensity の中で腕と一緒に回す)
            float spin = uTime * MIST_SPIN;
            float R = sc.x;
            for (int i = 0; i < 8; i++) {
              vec3 p = uCamPos + rd * (l0 + (float(i) + 0.5) * seg);
              vec2 q = p.xz - uMistAt.xz;
              // 余韻では筋に千切れる (閾値を上げる)
              float band = mistDensity(q, R, spin, mf, flow * 0.4);
              float low = exp(-max(p.y - mistGroundAt(p.xz) - 0.5 - 2.5 * mf, 0.0) * 0.5 * (1.0 - 0.5 * mf));
              m += band * low * seg * 0.6;
            }
          }
        }
        // (M22-07 の 3 回目) 地面に這う薄い霧の膜: 当たった所 wp の渦の濃さを、膜 (厚み MIST_SHEET m) を視線が抜ける長さだけ足す。
        // 地形に沿うので、中心より高い丘の上でも腕が切れず、見下ろすと腕の輪郭がくっきり出る (雑音 1 回を足すだけ)。
        // 樹冠や幹 (地面の高さの表より 0.5 m 以上高い所) には掛けない。楕円体に視線が入らなくても (丘の上) 掛ける
        if (!sky) {
          float lowG = exp(-max(wp.y - mistGroundAt(wp.xz) - 0.5 - 2.5 * mf, 0.0) * 1.5);
          m += mistDensity(wp.xz - uMistAt.xz, sc.x, uTime * MIST_SPIN, mf, mistFlow(uTime) * 0.4) * lowG * min(MIST_SHEET / max(-rd.y, 0.1), 9.0);
        }
        if (m > 0.0) {
            float Tm = exp(-m * MIST_K * uMistAmt);
            // (M22-07 の手直し) 余韻では霧の色を空気の色へ寄せる (紫が抜けて灰色に散っていく)
            outc = outc * Tm + mix(uMistColor, uFogColor, 0.45 * mf) * (1.0 - Tm);
            Tt *= Tm;
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
  /** (M22-07 の 3 回目) 霧の下の地面の高さの表 (MIST_GROUND × MIST_GROUND、霧の中心と半径が変わったときだけ焼き直す) */
  private mistGround: DataTexture | null = null;
  private mistGroundKey = '';
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
  // (M22-07 の手直し) fade は消えていく段 (0〜1、fx.ts の mistEnvelope)。余韻で霧を広げ、持ち上げ、筋に千切る
  // (M22-07 の 3 回目) heightAt を渡すと、霧の下の地面の高さを表に焼き、霧を地形に沿わせる (中心より高い丘の上でも地を這う)
  setMist(at: { x: number; y: number; z: number }, radiusM: number, amount: number, fade = 0, heightAt?: (x: number, z: number) => number): void {
    if (heightAt && amount > 0) this.bakeMistGround(at, radiusM, heightAt);
    (this.mat.uniforms.uMistAt.value as Vector4).set(at.x, at.y, at.z, radiusM);
    this.mat.uniforms.uMistAmt.value = amount;
    this.mat.uniforms.uMistFade.value = fade;
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

  /** (M22-07 の 3 回目) 霧の中心から余韻で広がる半径 (1.35 倍) の少し外までの地面の高さを 64 × 64 の表 (8 bit、下限と幅で戻す) に焼く */
  private bakeMistGround(at: { x: number; z: number }, radiusM: number, heightAt: (x: number, z: number) => number): void {
    const key = `${at.x},${at.z},${radiusM}`;
    if (key === this.mistGroundKey) return;
    this.mistGroundKey = key;
    const N = 64;
    const size = radiusM * 1.45 * 2;
    const x0 = at.x - size / 2;
    const z0 = at.z - size / 2;
    const h = new Float32Array(N * N);
    let lo = Infinity;
    let hi = -Infinity;
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const v = heightAt(x0 + ((i + 0.5) / N) * size, z0 + ((j + 0.5) / N) * size);
        h[j * N + i] = v;
        lo = Math.min(lo, v);
        hi = Math.max(hi, v);
      }
    }
    const range = Math.max(hi - lo, 0.01);
    const data = new Uint8Array(N * N);
    for (let k = 0; k < N * N; k++) data[k] = Math.round(((h[k] - lo) / range) * 255);
    this.mistGround?.dispose();
    const tex = new DataTexture(data, N, N, RedFormat);
    tex.magFilter = LinearFilter;
    tex.minFilter = LinearFilter;
    tex.needsUpdate = true;
    this.mistGround = tex;
    const u = this.mat.uniforms;
    u.tMistGround.value = tex;
    (u.uMistGround.value as Vector4).set(x0, z0, size, 0);
    (u.uMistGroundH.value as Vector2).set(lo, range);
  }

  dispose(): void {
    this.mistGround?.dispose();
    this.mat.dispose();
    this.quad.dispose();
  }
}
