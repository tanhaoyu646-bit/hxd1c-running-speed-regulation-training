import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { SCENARIOS, SPEED_ROUTE_WINDOW } from '../scripts/speedRegulationConfig.js';
import { buildRailAlignedPath, cumulativePathDistances } from '../scripts/railAlignedPath.js';
import {
  createCandidateAttempt,
  loadCandidateDraft,
  saveCandidateDraft,
  validateCandidate,
} from '../scripts/speedRegulationCandidate.js';

const memoryStorage = () => {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
};

test('姓名与学号校验并形成独立考评身份', () => {
  assert.equal(validateCandidate({ name: '张三', studentId: '20260001' }).valid, true);
  assert.equal(validateCandidate({ name: '张3', studentId: '20260001' }).valid, false);
  assert.equal(validateCandidate({ name: '张三', studentId: '1' }).valid, false);
  const attempt = createCandidateAttempt({ name: '  张 三  ', studentId: '2026-001' }, new Date('2026-10-28T01:02:03Z'));
  assert.deepEqual(attempt, { name: '张 三', studentId: '2026-001', startedAt: '2026-10-28T01:02:03.000Z' });
});

test('考生草稿只写入传入的会话存储', () => {
  const storage = memoryStorage();
  saveCandidateDraft({ name: '李四', studentId: 'A2026002' }, storage);
  assert.deepEqual(loadCandidateDraft(storage), { name: '李四', studentId: 'A2026002' });
});

test('两个技能共用覆盖桥梁、邻线和原生隧道的独立环境窗口', () => {
  for (const scenario of Object.values(SCENARIOS)) {
    assert.equal(scenario.routeWindow, SPEED_ROUTE_WINDOW);
    assert.ok(scenario.startOffset >= SPEED_ROUTE_WINDOW.start);
    assert.ok(scenario.startOffset + scenario.finishDistance <= SPEED_ROUTE_WINDOW.end);
  }
  assert.ok(SPEED_ROUTE_WINDOW.end >= 32_000);
});

test('途中调速地形全部来自原 NEIYI 高程块并覆盖隧道出口', async () => {
  const terrain = JSON.parse(await readFile(new URL('../assets/msts-neiyi-corridor/neiyi-speed-regulation-terrain.json', import.meta.url), 'utf8'));
  const keys = new Set(terrain.tiles.map((tile) => `${tile.tileX},${tile.tileZ}`));
  assert.equal(terrain.format, 'msts-terrain-corridor-v1');
  assert.equal(terrain.summary.tileCount, 10);
  assert.equal(terrain.summary.resolution, 129);
  for (const key of ['-5732,14701', '-5731,14701', '-5730,14701', '-5730,14702', '-5729,14702', '-5728,14703']) assert.ok(keys.has(key), `缺少地形块 ${key}`);
  assert.ok(terrain.tiles.every((tile) => !tile.synthetic && tile.heights.length === 129 * 129));
});

test('途中调速连续重建本务线并保留原桥梁邻线，填写信息时预加载', async () => {
  const routeSource = await readFile(new URL('../scripts/mstsRouteScene.js', import.meta.url), 'utf8');
  const appSource = await readFile(new URL('../scripts/speedRegulationApp.js', import.meta.url), 'utf8');
  const scene = JSON.parse(await readFile(new URL('../assets/msts-neiyi-corridor/neiyi-lookout-full-scene.json', import.meta.url), 'utf8'));
  assert.match(routeSource, /SPEED_REGULATION_ROUTE_RENDER_OPTIONS[\s\S]*proceduralTrack:\s*true[\s\S]*continuousRailHeads:\s*true/);
  assert.match(routeSource, /this\.isSpeedRegulation\s*\?\s*SPEED_REGULATION_ROUTE_RENDER_OPTIONS/);
  assert.match(routeSource, /String\(instance\.shape \|\| ''\)\.toLowerCase\(\)/);
  assert.match(routeSource, /String\(shape\.fileName \|\| ''\)\.toLowerCase\(\)/);
  assert.ok(scene.instances.some((instance) => instance.uid === 31 && instance.shape === 'A1t100mstrt.s'));
  assert.ok(scene.shapes['A1t100mStrt.s']);
  assert.match(appSource, /function preloadRouteScene\(\)/);
  assert.match(appSource, /window\.__speedRegulation[^\n]+\npreloadRouteScene\(\);\nsetupCandidateGate\(\);/);
});

test('驾驶中心线不产生超出原TrackDB节点的高程过冲', async () => {
  const path = JSON.parse(await readFile(new URL('../assets/msts-neiyi/neiyi-5635-trackdb-path.json', import.meta.url), 'utf8'));
  const scene = JSON.parse(await readFile(new URL('../assets/msts-neiyi-corridor/neiyi-lookout-full-scene.json', import.meta.url), 'utf8'));
  const controls = Array.from({ length: path.positions.length / 3 }, (_, index) => path.positions.slice(index * 3, index * 3 + 3));
  const sourceMaximumGrade = controls.slice(1).reduce((maximum, point, index) => {
    const previous = controls[index];
    const horizontal = Math.hypot(point[0] - previous[0], point[2] - previous[2]);
    return Math.max(maximum, horizontal > 0.001 ? Math.abs((point[1] - previous[1]) / horizontal * 1000) : 0);
  }, 0);
  const aligned = buildRailAlignedPath(path.positions, scene.instances, { spacing: 5 });
  const distances = cumulativePathDistances(aligned);
  let alignedMaximumGrade = 0;
  for (let index = 1; index < aligned.length; index += 1) {
    const horizontal = Math.hypot(aligned[index][0] - aligned[index - 1][0], aligned[index][2] - aligned[index - 1][2]);
    if (horizontal > 0.001) alignedMaximumGrade = Math.max(alignedMaximumGrade, Math.abs((aligned[index][1] - aligned[index - 1][1]) / horizontal * 1000));
  }
  assert.ok(distances.at(-1) > 38_000);
  assert.ok(alignedMaximumGrade <= sourceMaximumGrade + 0.8, `${alignedMaximumGrade} > ${sourceMaximumGrade}`);

  const normalized = buildRailAlignedPath(path.positions, scene.instances, {
    spacing: 5,
    normalizeVerticalProfile: true,
    maximumGrade: 35,
    recoveryDistance: 1800,
  });
  let normalizedMaximumGrade = 0;
  for (let index = 1; index < normalized.length; index += 1) {
    const horizontal = Math.hypot(normalized[index][0] - normalized[index - 1][0], normalized[index][2] - normalized[index - 1][2]);
    if (horizontal > 0.001) normalizedMaximumGrade = Math.max(normalizedMaximumGrade, Math.abs((normalized[index][1] - normalized[index - 1][1]) / horizontal * 1000));
  }
  assert.ok(normalizedMaximumGrade <= 35.8, `平滑后最大坡度 ${normalizedMaximumGrade.toFixed(2)}‰`);
});

test('驾驶台原位LKJ显示实时速度且相机跟随轨道坡度', async () => {
  const appSource = await readFile(new URL('../scripts/speedRegulationApp.js', import.meta.url), 'utf8');
  const routeSource = await readFile(new URL('../scripts/mstsRouteScene.js', import.meta.url), 'utf8');
  const css = await readFile(new URL('../styles/speed-regulation.css', import.meta.url), 'utf8');
  assert.match(appSource, /className = 'cab-lkj-live'/);
  assert.match(appSource, /querySelector\('b'\)\.textContent = s\.speed\.toFixed\(0\)/);
  assert.match(css, /\.cab-lkj-live/);
  assert.match(routeSource, /const trackPitch = Math\.asin/);
  assert.match(routeSource, /getPathGrade\(/);
});

test('进入页与成绩单均包含考生身份字段', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  for (const id of ['candidate-name', 'candidate-student-id', 'result-name', 'result-student-id']) assert.match(html, new RegExp(`id="${id}"`));
});
