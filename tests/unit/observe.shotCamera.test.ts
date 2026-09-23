import { describe, it, expect } from 'vitest';
import { BoxGeometry, Mesh, MeshBasicMaterial, PerspectiveCamera, Raycaster, Vector3, type Object3D } from 'three';
import { createShotCamera } from '../../src/observe/render/shotCamera';
import type { Agent } from '../../src/observe/agents';
import type { Shot } from '../../src/observe/director';

const flat = () => 0;
const deer = (id: number, x: number, z: number): Agent => ({ id, species: 'deer', role: 'wild', x, z, heading: 0, state: 'graze', t: 0 });

describe('自動カメラ (shotCamera)', () => {
  it('群れの寄りで、狙いでない鹿がカメラのすぐ前に入ると、その上へ持ち上げて越す', () => {
    const camera = new PerspectiveCamera();
    const subject = deer(1, 0, 0);
    const shot: Shot = { kind: 'herdClose', subject: { agent: 1 }, duration: 12, reason: 'herd' };
    const cam = createShotCamera(camera, flat, () => [], 80, () => 0);
    cam.start(shot, [subject]);
    for (let i = 0; i < 60; i++) cam.update(1 / 30, [subject]);
    const clearY = camera.position.y;
    // カメラと狙いの間、カメラから 2 m の所に別の鹿を置く
    const toAim = new Vector3(-camera.position.x, 0, -camera.position.z).normalize();
    const blocker = deer(2, camera.position.x + toAim.x * 2, camera.position.z + toAim.z * 2);
    for (let i = 0; i < 90; i++) cam.update(1 / 30, [subject, blocker]);
    expect(camera.position.y - clearY).toBeGreaterThan(1.5);
    // 鹿がカメラの後ろなら持ち上げない
    const behind = deer(3, camera.position.x - toAim.x * 2, camera.position.z - toAim.z * 2);
    for (let i = 0; i < 120; i++) cam.update(1 / 30, [subject, behind]);
    expect(camera.position.y - clearY).toBeLessThan(0.2);
  });

  it('ショットの始めに、狙いとの間の遮り (集落の巨石など) を避ける向きを選ぶ', () => {
    const shot: Shot = { kind: 'shipLookUp', subject: { x: 0, z: 0 }, duration: 12, reason: 'landscape' };
    // 遮りが無ければ、rng = 0 のとき最初の向き (+z 側 36 m) に立つ
    const openCam = new PerspectiveCamera();
    createShotCamera(openCam, flat, () => [], 80, () => 0).start(shot, []);
    expect(openCam.position.z).toBeGreaterThan(30);
    // その途中に大きな石を置くと、石を通らない向きへ回る
    const stone = new Mesh(new BoxGeometry(8, 12, 2), new MeshBasicMaterial());
    stone.position.set(0, 6, 30);
    stone.updateMatrixWorld();
    const blockers: Object3D[] = [stone];
    const camera = new PerspectiveCamera();
    createShotCamera(camera, flat, () => blockers, 80, () => 0).start(shot, []);
    const seg = new Vector3(0, 7, 0).sub(camera.position);
    expect(new Raycaster(camera.position.clone(), seg.clone().normalize(), 0, seg.length()).intersectObjects(blockers, true)).toHaveLength(0);
  });

  it('避ける球 (舟) を、ショットの始めにも終わりにも狙いより手前に映さない', () => {
    const shot: Shot = { kind: 'settlementHigh', subject: { x: 0, z: 0 }, duration: 20, reason: 'landscape' };
    // rng = 0 の最初の向き (+z 側 46 m、高さ 30 m) の、狙いとの間に球を置く
    const zone = { x: 0, y: 12, z: 28, r: 12 };
    const avoid = (s: Shot) => (s.kind === 'settlementHigh' ? [zone] : []);
    const openCam = new PerspectiveCamera();
    createShotCamera(openCam, flat, () => [], 80, () => 0).start(shot, []);
    const inFrame = (camera: PerspectiveCamera) => {
      camera.updateMatrixWorld();
      const p = new Vector3(zone.x, zone.y, zone.z).project(camera);
      return p.z < 1 && Math.abs(p.x) < 1 && Math.abs(p.y) < 1;
    };
    expect(inFrame(openCam)).toBe(true);
    const camera = new PerspectiveCamera();
    const cam = createShotCamera(camera, flat, () => [], 80, () => 0, avoid);
    cam.start(shot, []);
    expect(inFrame(camera)).toBe(false);
    for (let i = 0; i < 20 * 30; i++) cam.update(1 / 30, []);
    expect(inFrame(camera)).toBe(false);
  });

  it('海岸の引きは陸の側 (区域の中心の側) から海を向き、水平線が画に入る', () => {
    const coast = { x: -30, z: 50 };
    const shot: Shot = { kind: 'coastWide', subject: coast, duration: 16, reason: 'landscape' };
    for (const r of [0, 0.5, 0.99]) {
      const camera = new PerspectiveCamera(40, 16 / 9);
      createShotCamera(camera, flat, () => [], 80, () => r).start(shot, []);
      expect(Math.hypot(camera.position.x, camera.position.z)).toBeLessThan(Math.hypot(coast.x, coast.z));
      // 俯角が画角の半分 (20°) より浅ければ、水平線は画の中
      const dir = camera.getWorldDirection(new Vector3());
      expect((Math.asin(-dir.y) * 180) / Math.PI).toBeLessThan(20);
    }
  });
});
