import {
  AdditiveBlending,
  BufferAttribute,
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

const pointVertex = /* glsl */ `
  attribute float aSeed;
  attribute float aAlpha;
  uniform float uTime;
  uniform float uSize;
  uniform float uScale;
  uniform int uMode;
  uniform vec3 uOrigin;
  uniform float uBox;
  varying float vAlpha;
  void main() {
    vec3 p = position;
    float a = aAlpha;
    if (uMode == 0) {
      // 塵: 風で流し、カメラを中心にした箱の中へ折り返す
      p += vec3(0.35, 0.05, 0.18) * uTime + vec3(sin(uTime * 0.3 + aSeed * 6.0), sin(uTime * 0.23 + aSeed * 9.0), cos(uTime * 0.27 + aSeed * 4.0)) * 0.6;
      p = mod(p - uOrigin + uBox * 0.5, uBox) + uOrigin - uBox * 0.5;
      a *= 0.55 + 0.45 * sin(uTime * 1.7 + aSeed * 30.0);
    } else if (uMode == 1) {
      // 蛍: 元の場所の周りをゆっくり巡り、ときどき灯る
      p += vec3(sin(uTime * 0.37 + aSeed * 11.0) * 1.6, sin(uTime * 0.51 + aSeed * 7.0) * 0.45, cos(uTime * 0.29 + aSeed * 5.0) * 1.6);
      a *= pow(max(sin(uTime * (0.6 + aSeed * 0.5) + aSeed * 40.0), 0.0), 3.0);
    }
    vAlpha = a;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_PointSize = uSize * uScale / max(-mv.z, 0.5);
    gl_Position = projectionMatrix * mv;
  }
`;

const pointFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uAmount;
  varying float vAlpha;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float soft = smoothstep(0.5, 0.0, d);
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

export type MotesInput = { rng: () => number; heightAt(x: number, z: number): number; lanterns: { x: number; z: number }[]; fireflyAt: { x: number; z: number }[] };
export type Motes = { group: Group; update(t: number, dt: number, night: number, camera: { position: Vector3 }, target: Vector3, agents: readonly Agent[]): void };

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
  group.add(dust, flies, vit);

  const up = new Vector3();
  return {
    group,
    update(t, dt, night, camera, target, agents) {
      const scale = window.innerHeight * 0.9;
      for (const m of [dustMat, flyMat, vitMat]) {
        m.uniforms.uTime.value = t;
        m.uniforms.uScale.value = scale;
      }
      (dustMat.uniforms.uOrigin.value as Vector3).copy(target);
      dustMat.uniforms.uAmount.value = 1 - night;
      flyMat.uniforms.uAmount.value = Math.max(0, night - 0.3) / 0.7;
      poolMat.uniforms.uAmount.value = night;
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
  };
}
