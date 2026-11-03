import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from '../lib/three/three.module.js';
import { MstsRouteScene } from '../scripts/mstsRouteScene.js';

test('原桥面两端与本务线中心线采用同一高程，桥段接头不再有数米落差', async () => {
  const sceneData = JSON.parse(await readFile(new URL('../assets/msts-neiyi-corridor/neiyi-lookout-full-scene.json', import.meta.url)));
  const pathData = JSON.parse(await readFile(new URL('../assets/msts-neiyi/neiyi-5635-trackdb-path.json', import.meta.url)));
  const scene = Object.create(MstsRouteScene.prototype);
  scene.isSpeedRegulation = true;
  scene.routeRoot = new THREE.Group();
  scene.getMaterial = () => new THREE.MeshBasicMaterial();
  scene.buildRoutePath(pathData, sceneData);
  const bridgeInstances = sceneData.instances.filter((instance) => [807, 50633].includes(instance.uid)
    && /^cn_bridge_(150|60)mstrt\.s$/i.test(instance.shape));
  assert.equal(bridgeInstances.length, 2);
  for (const instance of bridgeInstances) {
    const shape = Object.values(sceneData.shapes).find((candidate) => candidate.fileName.toLowerCase() === instance.shape.toLowerCase());
    assert.ok(scene.buildGradeAlignedBridge(instance, shape));
    const bridge = scene.routeRoot.children.at(-1);
    const beam = bridge.children[0];
    const source = shape.groups[0].positions;
    const corrected = beam.geometry.attributes.position.array;
    const zValues = source.filter((_, index) => index % 3 === 2);
    const minZ = Math.min(...zValues);
    const maxZ = Math.max(...zValues);
    for (const endZ of [minZ, maxZ]) {
      const offsets = [];
      for (let index = 0; index < source.length; index += 3) {
        if (Math.abs(source[index + 1]) > .01 || Math.abs(source[index + 2] - endZ) > 2) continue;
        const point = new THREE.Vector3(corrected[index], corrected[index + 1], corrected[index + 2]);
        bridge.localToWorld(point);
        offsets.push(Math.abs(scene.projectPointToPath(point.toArray()).point.y - point.y));
      }
      assert.ok(offsets.length, `桥 ${instance.uid} 端点缺少桥面参考点`);
      assert.ok(Math.max(...offsets) < .25, `桥 ${instance.uid} 端点高差 ${Math.max(...offsets).toFixed(2)} m`);
    }
  }
});

test('途中调速使用原游戏通过信号机和进站信号机本体', async () => {
  const source = await readFile(new URL('../scripts/speedRegulationScene.js', import.meta.url), 'utf8');
  const base = await readFile(new URL('../scripts/mstsRouteScene.js', import.meta.url), 'utf8');
  assert.match(source, /createSourceShapeObject\(this\.repairAssetData, 'tongguo\.s'/);
  assert.match(source, /createSourceShapeObject\(this\.sourceSceneData, 'jinzhan\.s'/);
  assert.match(base, /this\.sourceSceneData = sceneData/);
  assert.match(base, /this\.repairAssetData = repairAssetData/);
});
