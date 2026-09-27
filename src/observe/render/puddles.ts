import { BufferAttribute, BufferGeometry, Color, Mesh, PlaneGeometry, ShaderMaterial } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * 雨の水たまり (M22-07 の手直し、審査台 2026-09-24 20:25 の判断「水たまりと波紋がない」)。
 * 踏み固めた所 (集落の広場・道・小屋の戸口) の窪みに、雨の濡れ (fx.ts の wetness) に合わせて広がる水たまり。
 * 空を暗く映す面と、雨粒の波紋の輪 (1.3 m の升ごとに 1 つの輪が広がって消える、升を 2 枚ずらして重ねる)。
 * 全部の水たまりを 1 つの形にまとめて 1 draw call。濡れが 0 のときは描かない。
 */
export type PuddleSpot = { x: number; z: number; r: number };
export type Puddles = {
  mesh: Mesh;
  /** 濡れ (0〜1、水たまりの広がり)・雨の強さ (0〜1、波紋の数)・空の色 (映り込み)・時刻 (秒) */
  update(wet: number, rain: number, sky: Color, t: number): void;
};

const fragment = /* glsl */ `
  uniform float uWet;
  uniform float uRain;
  uniform float uTime;
  uniform vec3 uSky;
  uniform vec3 uMud;
  varying vec2 vLocal;
  varying vec2 vXZ;
  varying float vSeed;
  float vn(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = fract(sin(dot(i, vec2(127.1, 311.7))) * 43758.5453);
    float b = fract(sin(dot(i + vec2(1.0, 0.0), vec2(127.1, 311.7))) * 43758.5453);
    float c = fract(sin(dot(i + vec2(0.0, 1.0), vec2(127.1, 311.7))) * 43758.5453);
    float d = fract(sin(dot(i + vec2(1.0, 1.0), vec2(127.1, 311.7))) * 43758.5453);
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }
  void main() {
    // 形: 円を雑音で崩し、濡れに合わせて縁を外へ広げる
    float r = length(vLocal) + (vn(vLocal * 2.2 + vSeed * 17.0) - 0.5) * 0.55;
    float edge = 0.25 + 0.7 * uWet;
    float mask = smoothstep(edge, edge - 0.12, r);
    if (mask < 0.01) discard;
    // 縁は濡れた泥の色、中は空を暗く映す (水面は地面より暗く、空の色を少しだけ拾う)。映り込みのむらを雑音で
    float inner = smoothstep(edge - 0.02, edge - 0.3, r);
    vec3 col = mix(uMud * 0.7, uSky * 0.34 + vec3(0.02, 0.03, 0.04), inner);
    col *= 0.8 + 0.4 * vn(vXZ * 0.6 + vSeed * 5.0);
    // 岸の細い光 (水の縁が空を照り返す)
    col += uSky * 0.22 * smoothstep(0.06, 0.0, abs(r - (edge - 0.1)));
    // 雨の波紋
    float rings = 0.0;
    for (int k = 0; k < 2; k++) {
      vec2 q = vXZ / 1.3 + float(k) * vec2(0.5, 0.37);
      vec2 cell = floor(q);
      vec2 h = fract(sin(vec2(dot(cell, vec2(127.1, 311.7)), dot(cell, vec2(269.5, 183.3)))) * 43758.5453);
      float ph = fract(uTime * 1.5 + h.x * 7.0);
      float d = length(q - (cell + 0.3 + 0.4 * h));
      rings += smoothstep(0.07, 0.0, abs(d - ph * 0.42)) * (1.0 - ph);
    }
    float px = length(fwidth(vXZ));
    col = mix(col, uSky * 1.1, clamp(rings, 0.0, 1.0) * uRain * 0.8 * smoothstep(0.14, 0.03, px));
    float a = mask * 0.9;
    gl_FragColor = vec4(col * a, a);
    #include <colorspace_fragment>
  }
`;

const vertex = /* glsl */ `
  attribute vec2 aLocal;
  attribute float aSeed;
  varying vec2 vLocal;
  varying vec2 vXZ;
  varying float vSeed;
  void main() {
    vLocal = aLocal;
    vSeed = aSeed;
    vec4 w = modelMatrix * vec4(position, 1.0);
    vXZ = w.xz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

/** 水たまりの置き場所: 踏み固めた所の円 (中心・半径) の中から、周りより低い所を選ぶ。rng で決め、count まで */
export function puddleSpots(worn: readonly { x: number; z: number; r: number }[], heightAt: (x: number, z: number) => number, rng: () => number, count: number): PuddleSpot[] {
  const out: PuddleSpot[] = [];
  for (let tries = 0; tries < count * 30 && out.length < count; tries++) {
    const w = worn[Math.floor(rng() * worn.length)];
    const a = rng() * Math.PI * 2;
    const d = Math.sqrt(rng()) * w.r * 0.85;
    const x = w.x + Math.cos(a) * d;
    const z = w.z + Math.sin(a) * d;
    const r = 1.2 + rng() * 1.8;
    // 周り (半径の 1.5 倍) の 6 点の平均より低い (窪み) か、平ら (傾き 12% 未満) な所だけ
    const h = heightAt(x, z);
    let sum = 0;
    let steep = 0;
    for (let k = 0; k < 6; k++) {
      const b = (k / 6) * Math.PI * 2;
      const hk = heightAt(x + Math.cos(b) * r * 1.5, z + Math.sin(b) * r * 1.5);
      sum += hk;
      steep = Math.max(steep, Math.abs(hk - h) / (r * 1.5));
    }
    if (h > sum / 6 - 0.01 && steep > 0.12) continue;
    if (out.some((o) => Math.hypot(o.x - x, o.z - z) < o.r + r)) continue;
    out.push({ x, z, r });
  }
  return out;
}

export function createPuddles(spots: readonly PuddleSpot[], heightAt: (x: number, z: number) => number): Puddles {
  const parts: BufferGeometry[] = [];
  spots.forEach((s, i) => {
    const g = new PlaneGeometry(s.r * 2, s.r * 2, 8, 8);
    g.rotateX(-Math.PI / 2);
    const pos = g.getAttribute('position') as BufferAttribute;
    const local = new Float32Array(pos.count * 2);
    const seed = new Float32Array(pos.count).fill(i * 0.137 + 0.21);
    for (let k = 0; k < pos.count; k++) {
      local[k * 2] = pos.getX(k) / s.r;
      local[k * 2 + 1] = pos.getZ(k) / s.r;
      pos.setY(k, heightAt(s.x + pos.getX(k), s.z + pos.getZ(k)) + 0.05);
    }
    g.translate(s.x, 0, s.z);
    g.setAttribute('aLocal', new BufferAttribute(local, 2));
    g.setAttribute('aSeed', new BufferAttribute(seed, 1));
    g.deleteAttribute('normal');
    g.deleteAttribute('uv');
    parts.push(g);
  });
  const geo = parts.length ? mergeGeometries(parts) : new BufferGeometry();
  const mat = new ShaderMaterial({
    uniforms: { uWet: { value: 0 }, uRain: { value: 0 }, uTime: { value: 0 }, uSky: { value: new Color('#B8C6CC') }, uMud: { value: new Color('#4E4636') } },
    vertexShader: vertex,
    fragmentShader: fragment,
    transparent: true,
    premultipliedAlpha: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
  });
  const mesh = new Mesh(geo, mat);
  mesh.name = 'observe-puddles';
  mesh.renderOrder = 1;
  mesh.visible = false;
  return {
    mesh,
    update(wet, rain, sky, t) {
      mesh.visible = wet > 0.01 && parts.length > 0;
      mat.uniforms.uWet.value = wet;
      mat.uniforms.uRain.value = rain;
      mat.uniforms.uTime.value = t;
      (mat.uniforms.uSky.value as Color).copy(sky);
    },
  };
}
