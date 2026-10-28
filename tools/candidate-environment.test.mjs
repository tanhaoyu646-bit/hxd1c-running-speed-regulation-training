import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { SCENARIOS, SPEED_ROUTE_WINDOW } from '../scripts/speedRegulationConfig.js';
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

test('途中调速保留原桥梁主线和邻线且在填写信息时预加载', async () => {
  const routeSource = await readFile(new URL('../scripts/mstsRouteScene.js', import.meta.url), 'utf8');
  const appSource = await readFile(new URL('../scripts/speedRegulationApp.js', import.meta.url), 'utf8');
  const scene = JSON.parse(await readFile(new URL('../assets/msts-neiyi-corridor/neiyi-lookout-full-scene.json', import.meta.url), 'utf8'));
  assert.match(routeSource, /SPEED_REGULATION_ROUTE_RENDER_OPTIONS[\s\S]*proceduralTrack:\s*false/);
  assert.match(routeSource, /this\.isSpeedRegulation\s*\?\s*SPEED_REGULATION_ROUTE_RENDER_OPTIONS/);
  assert.match(routeSource, /String\(instance\.shape \|\| ''\)\.toLowerCase\(\)/);
  assert.match(routeSource, /String\(shape\.fileName \|\| ''\)\.toLowerCase\(\)/);
  assert.ok(scene.instances.some((instance) => instance.uid === 31 && instance.shape === 'A1t100mstrt.s'));
  assert.ok(scene.shapes['A1t100mStrt.s']);
  assert.match(appSource, /function preloadRouteScene\(\)/);
  assert.match(appSource, /window\.__speedRegulation[^\n]+\npreloadRouteScene\(\);\nsetupCandidateGate\(\);/);
});

test('进入页与成绩单均包含考生身份字段', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  for (const id of ['candidate-name', 'candidate-student-id', 'result-name', 'result-student-id']) assert.match(html, new RegExp(`id="${id}"`));
});
