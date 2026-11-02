import test from 'node:test';
import assert from 'node:assert/strict';
import { SCENARIOS, lkjControlLimit } from '../scripts/speedRegulationConfig.js';
import { SpeedRegulationSimulation } from '../scripts/speedRegulationSimulation.js';
import { SpeedRegulationAssessment } from '../scripts/speedRegulationAssessment.js';

function commonStart(simulation) {
  simulation.start();
  simulation.command('lkj-open');
  simulation.command('callout');
  simulation.command('traction', 0);
}

function runOneStage() {
  const simulation = new SpeedRegulationSimulation('oneStage');
  commonStart(simulation);
  let sideReleased = false;
  let brakeApplied = false;
  let pressureAdded = false;
  for (let index = 0; index < 12_000 && !simulation.state.completed; index += 1) {
    const state = simulation.state;
    if (state.distance > 1300 && !sideReleased) { simulation.command('side-release', true); sideReleased = true; }
    if (state.distance > 1400 && !brakeApplied) { simulation.command('auto-brake', 1); brakeApplied = true; }
    if (state.distance > 1800 && !pressureAdded) { simulation.command('auto-brake', 2); pressureAdded = true; }
    if (state.lkjForcedBrake && state.lkjLevel === 'normal' && state.speed <= state.lkjLimit + 1) simulation.command('lkj-relief');
    simulation.tick(.05);
  }
  return simulation;
}

function runTwoStage() {
  const simulation = new SpeedRegulationSimulation('twoStage');
  commonStart(simulation);
  let sideReleased = false;
  let firstApplied = false;
  let firstReleased = false;
  let secondApplied = false;
  for (let index = 0; index < 20_000 && !simulation.state.completed; index += 1) {
    const state = simulation.state;
    if (state.distance > 1300 && !sideReleased) { simulation.command('side-release', true); sideReleased = true; }
    if (state.distance > 1400 && !firstApplied) { simulation.command('auto-brake', 1); firstApplied = true; }
    if (state.speed < 95 && firstApplied && !firstReleased) {
      simulation.command('auto-brake', 0);
      simulation.command('traction', 2);
      firstReleased = true;
    }
    if (state.distance > 3300 && firstReleased && !secondApplied) {
      simulation.command('traction', 0);
      simulation.command('auto-brake', 1);
      secondApplied = true;
    }
    if (state.lkjForcedBrake && state.lkjLevel === 'normal' && state.speed <= state.lkjLimit + 1) simulation.command('lkj-relief');
    simulation.tick(.05);
  }
  return simulation;
}

test('两个技能配置、里程和状态互相独立', () => {
  assert.notEqual(SCENARIOS.oneStage.startOffset, SCENARIOS.twoStage.startOffset);
  assert.equal(SCENARIOS.oneStage.initialSpeed, 110);
  assert.equal(SCENARIOS.twoStage.initialSpeed, 110);
  assert.equal(SCENARIOS.oneStage.entryDistance, 3000);
  assert.equal(SCENARIOS.twoStage.entryDistance, 5000);
  assert.ok(SCENARIOS.oneStage.phases[0].end >= 1000);
  assert.ok(SCENARIOS.twoStage.phases[0].end >= 700);
  assert.equal(SCENARIOS.oneStage.startOffset + SCENARIOS.oneStage.entryDistance, SCENARIOS.twoStage.startOffset + SCENARIOS.twoStage.entryDistance);
  const first = new SpeedRegulationSimulation('oneStage');
  const second = new SpeedRegulationSimulation('twoStage');
  first.command('traction', 0);
  assert.equal(second.state.traction, 2);
  assert.ok(lkjControlLimit(SCENARIOS.oneStage, 1900) < lkjControlLimit(SCENARIOS.oneStage, 200));
});

test('坡度进入动力学，网压电流与风压指针使用实时状态', () => {
  const downhill = new SpeedRegulationSimulation('oneStage');
  const uphill = new SpeedRegulationSimulation('oneStage');
  for (const simulation of [downhill, uphill]) {
    simulation.state.speed = 60;
    simulation.command('traction', 0);
    simulation.start();
  }
  downhill.state.grade = -20;
  uphill.state.grade = 20;
  for (let index = 0; index < 100; index += 1) { downhill.tick(.05); uphill.tick(.05); }
  assert.ok(downhill.state.speed > uphill.state.speed + 5);
  downhill.command('traction', 3);
  for (let index = 0; index < 40; index += 1) downhill.tick(.05);
  assert.ok(downhill.state.tractionCurrent > 100);
  assert.ok(downhill.state.netVoltage < 2500);
  downhill.command('traction', 0);
  downhill.command('auto-brake', 2);
  for (let index = 0; index < 100; index += 1) downhill.tick(.05);
  assert.ok(downhill.state.trainPipe < 600);
  assert.ok(downhill.state.brakeCylinder > 0);
  assert.ok(downhill.state.mainReservoir < 900);
});

test('牵引级位通过牵引力与电流改变加速度，电制动降低速度', () => {
  const outcomes = [-4, 0, 1, 2, 4, 7].map((level) => {
    const simulation = new SpeedRegulationSimulation('oneStage');
    simulation.state.speed = 60;
    simulation.state.grade = 0;
    simulation.start();
    simulation.command('traction', level);
    for (let index = 0; index < 400; index += 1) simulation.tick(.05);
    return { level, speed: simulation.state.speed, current: simulation.state.tractionCurrent };
  });
  for (let index = 1; index < outcomes.length; index += 1) {
    assert.ok(outcomes[index].speed > outcomes[index - 1].speed, JSON.stringify(outcomes));
  }
  assert.ok(outcomes.at(-1).current > outcomes[2].current);
});

test('考评进度只记录按顺序完成的操作', () => {
  const simulation = new SpeedRegulationSimulation('oneStage');
  const assessment = new SpeedRegulationAssessment(simulation);
  simulation.start();
  simulation.command('callout');
  simulation.command('traction', 0);
  assert.equal(assessment.progress().done, 0);
  simulation.command('lkj-open');
  assert.equal(assessment.progress().done, 1);
  simulation.command('callout');
  simulation.command('traction', 0);
  simulation.command('side-release', true);
  simulation.command('auto-brake', 1);
  assert.equal(assessment.progress().done, 5);
});

test('一段制动标准操作可在目标速度范围通过进站信号机', () => {
  const simulation = runOneStage();
  const result = new SpeedRegulationAssessment(simulation).result();
  assert.equal(simulation.state.completed, true);
  assert.ok(simulation.state.entrySpeed >= 35 && simulation.state.entrySpeed <= 45, `entry speed ${simulation.state.entrySpeed}`);
  assert.equal(result.qualified, true);
  assert.equal(result.redline, false);
});

test('两段制动包含缓解充风和第二次50kPa减压', () => {
  const simulation = runTwoStage();
  const result = new SpeedRegulationAssessment(simulation).result();
  const applications = simulation.state.events.filter((event) => event.type === 'auto-brake' && event.value > 0 && event.previous?.autoBrake === 0);
  assert.equal(simulation.state.completed, true);
  assert.ok(simulation.state.samples.some((sample) => sample.distance > SCENARIOS.twoStage.rechargeWindow[0] && sample.distance < SCENARIOS.twoStage.rechargeWindow[1] && sample.pipe >= 590));
  assert.equal(applications.length, 2);
  assert.ok(simulation.state.entrySpeed <= 45, `entry speed ${simulation.state.entrySpeed}`);
  assert.equal(result.qualified, true);
});

test('未制动超速会触发LKJ制动并判为安全红线', () => {
  const simulation = new SpeedRegulationSimulation('oneStage');
  simulation.start();
  simulation.command('traction', 7);
  for (let index = 0; index < 10_000 && !simulation.state.completed && simulation.state.distance < 2020; index += 1) simulation.tick(.05);
  assert.ok(simulation.state.events.some((event) => event.type === 'lkj-level' && ['service', 'emergency'].includes(event.to)));
  if (simulation.state.entrySpeed != null) {
    const result = new SpeedRegulationAssessment(simulation).result();
    assert.equal(result.redline, true);
    assert.equal(result.qualified, false);
  }
});
