import { Color, DataTexture, LinearFilter, MeshToonMaterial, RedFormat, type MeshToonMaterialParameters } from 'three';

/**
 * 観察画面の陰影 (設計 §8)。トゥーン寄りのランプ + 縁の光。基準画 (assets/textures/board/creatures) の
 * 「丸めた面に柔らかい絵画の陰影」に寄せるため、段の境界は線形補間でなめらかにする (NearestFilter だとセル画になる)。
 */
const RAMP = new Uint8Array([70, 120, 175, 225, 255]);
let rampTexture: DataTexture | null = null;

function ramp(): DataTexture {
  if (rampTexture) return rampTexture;
  rampTexture = new DataTexture(RAMP, RAMP.length, 1, RedFormat);
  rampTexture.minFilter = LinearFilter;
  rampTexture.magFilter = LinearFilter;
  rampTexture.generateMipmaps = false;
  rampTexture.needsUpdate = true;
  return rampTexture;
}

export type ToonOptions = MeshToonMaterialParameters & { rim?: number; rimColor?: string };

/** 縁の光に全体で掛ける色 (M22-07)。昼は白、夜は月の青く弱い光にして、夜に縁だけ白く浮かないようにする */
export const rimLight = { value: new Color(1, 1, 1) };

export function createToonMaterial(opts: ToonOptions = {}): MeshToonMaterial {
  const { rim = 0.35, rimColor = '#FFF1D6', ...params } = opts;
  const m = new MeshToonMaterial({ gradientMap: ramp(), ...params });
  const rimC = new Color(rimColor);
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uRim = { value: rim };
    shader.uniforms.uRimColor = { value: rimC };
    shader.uniforms.uRimLight = rimLight;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uRim;\nuniform vec3 uRimColor;\nuniform vec3 uRimLight;')
      .replace(
        '#include <dithering_fragment>',
        [
          'float rimTerm = pow(1.0 - saturate(dot(normal, normalize(vViewPosition))), 3.0);',
          'gl_FragColor.rgb += uRimColor * uRimLight * rimTerm * uRim;',
          '#include <dithering_fragment>',
        ].join('\n'),
      );
  };
  m.customProgramCacheKey = () => `toon-rim-${rim}-${rimColor}`;
  return m;
}

/** glTF の材質 (MeshStandardMaterial) を観察画面のトゥーンに置き換える。色・頂点色・テクスチャ・発光を引き継ぐ */
export function toonFromStandard(src: { color?: Color; map?: MeshToonMaterialParameters['map']; emissive?: Color; emissiveIntensity?: number; vertexColors?: boolean; name?: string; transparent?: boolean; opacity?: number; side?: MeshToonMaterialParameters['side'] }): MeshToonMaterial {
  const m = createToonMaterial({
    color: src.color?.clone() ?? new Color('#ffffff'),
    map: src.map ?? null,
    emissive: src.emissive?.clone() ?? new Color('#000000'),
    emissiveIntensity: src.emissiveIntensity ?? 1,
    vertexColors: src.vertexColors ?? false,
    transparent: src.transparent ?? false,
    opacity: src.opacity ?? 1,
    side: src.side,
  });
  m.name = src.name ?? '';
  return m;
}
