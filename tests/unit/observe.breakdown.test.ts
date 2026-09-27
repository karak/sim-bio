import { describe, it, expect } from 'vitest';
import { BoxGeometry, Group, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, PerspectiveCamera } from 'three';
import { triangleBreakdown } from '../../src/observe/render/breakdown';

describe('三角形の内訳 (軽量化の試算)', () => {
  it('インスタンスごとに、視錐台の中・影・距離で数え分ける', () => {
    const camera = new PerspectiveCamera(60, 1, 0.1, 500);
    camera.position.set(0, 0, 0);
    camera.lookAt(0, 0, -1);
    const scene = new Group();
    // 箱 (12 三角形) を 4 つ: 前 10 m・前 50 m・前 80 m・後ろ 20 m
    const inst = new InstancedMesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial(), 4);
    inst.castShadow = true;
    [-10, -50, -80, 20].forEach((z, i) => inst.setMatrixAt(i, new Matrix4().makeTranslation(0, 0, z)));
    const rock = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial());
    rock.position.set(0, 0, 5);
    scene.add(inst, rock);
    scene.updateMatrixWorld(true);
    const rows = triangleBreakdown(camera, { grass: [inst] }, scene);
    expect(rows.grass).toEqual({ drawn: 48, inView: 36, shadow: 48, beyond30: 24, beyond60: 12, instances: 4 });
    // 区分に入らないものは other。カメラの後ろなので視錐台の外
    expect(rows.other).toEqual({ drawn: 12, inView: 0, shadow: 0, beyond30: 0, beyond60: 0, instances: 1 });
  });
});
