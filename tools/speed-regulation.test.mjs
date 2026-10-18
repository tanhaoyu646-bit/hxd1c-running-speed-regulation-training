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
    if (state.distance > 70 && !sideReleased) { simulation.command('side-release', true); sideReleased = true; }
    if (state.distance > 100 && !brakeApplied) { simulation.command('auto-brake', 1); brakeApplied = true; }
    if (state.distance > 450 && !pressureAdded) { simulation.command('auto-brake', 2); pressureAdded = true; }
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
    if (state.distance > 620 && !sideReleased) { simulation.command('side-release', true); sideReleased = true; }
    if (state.distance > 720 && !firstApplied) { simulation.command('auto-brake', 1); firstApplied = true; }
    if (state.speed < 93 && firstApplied && !firstReleased) {
      simulation.command('auto-brake', 0);
      simulation.command('traction', 2);
      firstReleased = true;
    }
    if (state.distance > 3040 && firstReleased && !secondApplied) {
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
  assert.equal(SCENARIOS.oneStage.entryDistance, 2000);
  assert.equal(SCENARIOS.twoStage.entryDistance, 4500);
  const first = new SpeedRegulationSimulation('oneStage');
  const second = new SpeedRegulationSimulation('twoStage');
  first.command('traction', 0);
  assert.equal(second.state.traction, 2);
  assert.ok(lkjControlLimit(SCENARIOS.oneStage, 1900) < lkjControlLimit(SCENARIOS.oneStage, 200));
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
  assert.ok(simulation.state.samples.some((sample) => sample.distance > 1800 && sample.distance < 3400 && sample.pipe >= 590));
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
