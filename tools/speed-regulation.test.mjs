import test from 'node:test';
import assert from 'node:assert/strict';
import { SCENARIOS, lkjControlLimit, tractionTargetSpeed } from '../scripts/speedRegulationConfig.js';
import { SpeedRegulationSimulation } from '../scripts/speedRegulationSimulation.js';
import { SpeedRegulationAssessment } from '../scripts/speedRegulationAssessment.js';

function commonStart(simulation) {
  simulation.start();
  simulation.command('lkj-open');
  simulation.command('callout');
}

function runOneStage() {
  const simulation = new SpeedRegulationSimulation('oneStage');
  commonStart(simulation);
  let lastSignal = simulation.state.signal.id;
  let sideReleased = false;
  let brakeApplied = false;
  let pressureAdded = false;
  let targetSelected = false;
  let finalRelease = false;
  for (let index = 0; index < 12_000 && !simulation.state.completed; index += 1) {
    const state = simulation.state;
    if (state.signal.id !== lastSignal && state.signal.id !== 'clear') { simulation.command('callout'); lastSignal = state.signal.id; }
    if (state.distance > 2900 && !sideReleased) { simulation.command('side-release', true); sideReleased = true; }
    if (state.distance > 3000 && !brakeApplied) { simulation.command('auto-brake', 1); brakeApplied = true; }
    const firstBrake = state.events.find((event) => event.type === 'auto-brake' && event.value > 0);
    if (firstBrake && state.elapsed >= firstBrake.elapsed + 5.2 && !targetSelected) {
      simulation.command('traction', 4);
      targetSelected = true;
    }
    if (state.distance > 3200 && !pressureAdded) { simulation.command('auto-brake', 2); pressureAdded = true; }
    if (pressureAdded && state.speed < 48 && !finalRelease) { simulation.command('auto-brake', 0); finalRelease = true; }
    if (state.lkjForcedBrake && state.lkjLevel === 'normal' && state.speed <= state.lkjLimit + 1) simulation.command('lkj-relief');
    simulation.tick(.05);
  }
  return simulation;
}

function runTwoStage() {
  const simulation = new SpeedRegulationSimulation('twoStage');
  commonStart(simulation);
  let lastSignal = simulation.state.signal.id;
  let sideReleased = false;
  let firstApplied = false;
  let firstReleased = false;
  let firstTargetSelected = false;
  let secondApplied = false;
  let finalTargetSelected = false;
  let finalRelease = false;
  for (let index = 0; index < 20_000 && !simulation.state.completed; index += 1) {
    const state = simulation.state;
    if (state.signal.id !== lastSignal && state.signal.id !== 'clear') { simulation.command('callout'); lastSignal = state.signal.id; }
    if (state.distance > 1300 && !sideReleased) { simulation.command('side-release', true); sideReleased = true; }
    if (state.distance > 1400 && !firstApplied) { simulation.command('auto-brake', 1); firstApplied = true; }
    const applications = state.events.filter((event) => event.type === 'auto-brake' && event.value > 0 && event.previous?.autoBrake === 0);
    if (applications[0] && state.elapsed >= applications[0].elapsed + 5.2 && !firstTargetSelected) {
      simulation.command('traction', 9);
      firstTargetSelected = true;
    }
    if (state.speed < 95 && firstApplied && !firstReleased) {
      simulation.command('auto-brake', 0);
      firstReleased = true;
    }
    if (state.distance > 3300 && firstReleased && !secondApplied) {
      simulation.command('auto-brake', 1);
      secondApplied = true;
    }
    if (applications[1] && state.elapsed >= applications[1].elapsed + 5.2 && !finalTargetSelected) {
      simulation.command('traction', 4);
      finalTargetSelected = true;
    }
    if (secondApplied && state.speed < 55 && !finalRelease) { simulation.command('auto-brake', 0); finalRelease = true; }
    if (state.lkjForcedBrake && state.lkjLevel === 'normal' && state.speed <= state.lkjLimit + 1) simulation.command('lkj-relief');
    simulation.tick(.05);
  }
  return simulation;
}

test('两个技能配置、里程和状态互相独立，并共用实际信号位置', () => {
  assert.notEqual(SCENARIOS.oneStage, SCENARIOS.twoStage);
  assert.equal(SCENARIOS.oneStage.initialSpeed, 110);
  assert.equal(SCENARIOS.twoStage.initialSpeed, 110);
  assert.equal(SCENARIOS.oneStage.initialTraction, 11);
  assert.equal(SCENARIOS.twoStage.initialTraction, 11);
  assert.equal(SCENARIOS.oneStage.operatingGrade, 0);
  assert.equal(SCENARIOS.twoStage.operatingGrade, 0);
  assert.equal(SCENARIOS.oneStage.entryDistance, 5000);
  assert.equal(SCENARIOS.twoStage.entryDistance, 5000);
  assert.equal(SCENARIOS.oneStage.finishDistance, 5600);
  assert.equal(SCENARIOS.twoStage.finishDistance, 5600);
  assert.deepEqual(SCENARIOS.oneStage.brakeTargetNotches, [4]);
  assert.deepEqual(SCENARIOS.twoStage.brakeTargetNotches, [9, 4]);
  assert.ok(SCENARIOS.oneStage.phases[0].end >= 1200);
  assert.ok(SCENARIOS.twoStage.phases[0].end >= 700);
  assert.equal(SCENARIOS.oneStage.startOffset + SCENARIOS.oneStage.entryDistance, SCENARIOS.twoStage.startOffset + SCENARIOS.twoStage.entryDistance);
  assert.deepEqual(SCENARIOS.oneStage.signals.map(({ id, distance, aspect }) => ({ id, distance, aspect })), SCENARIOS.twoStage.signals.map(({ id, distance, aspect }) => ({ id, distance, aspect })));
  const first = new SpeedRegulationSimulation('oneStage');
  const second = new SpeedRegulationSimulation('twoStage');
  first.command('traction', 0);
  assert.equal(second.state.traction, SCENARIOS.twoStage.initialTraction);
  assert.ok(lkjControlLimit(SCENARIOS.oneStage, 3900) < lkjControlLimit(SCENARIOS.oneStage, 200));
});

test('途中调速固定按平道运行，网压电流与风压指针使用实时状态', () => {
  const simulation = new SpeedRegulationSimulation('oneStage');
  simulation.state.grade = 20;
  simulation.start();
  for (let index = 0; index < 100; index += 1) simulation.tick(.05);
  assert.equal(simulation.state.grade, 0);
  assert.ok(Math.abs(simulation.state.speed - 110) < 0.4);
  assert.ok(simulation.state.tractionCurrent > 100);
  assert.ok(simulation.state.netVoltage < 2500);
  simulation.command('traction', 0);
  simulation.command('auto-brake', 2);
  for (let index = 0; index < 100; index += 1) simulation.tick(.05);
  assert.ok(simulation.state.trainPipe < 600);
  assert.ok(simulation.state.brakeCylinder > 0);
  assert.ok(simulation.state.mainReservoir < 900);
});

test('牵引级位按10 km/h一级给定目标速度，超过给定速度不输出动力', () => {
  assert.equal(tractionTargetSpeed(2), 20);
  assert.equal(tractionTargetSpeed(11), 110);
  assert.equal(tractionTargetSpeed(12), 120);
  const cutoff = new SpeedRegulationSimulation('oneStage');
  cutoff.state.speed = 120;
  cutoff.state.grade = 0;
  cutoff.command('traction', 2);
  cutoff.start();
  cutoff.tick(.1);
  assert.equal(cutoff.state.tractionForce, 0);
  assert.ok(cutoff.state.tractionCurrent < 1);

  const outcomes = [-4, 0, 4, 7, 10, 12].map((level) => {
    const simulation = new SpeedRegulationSimulation('oneStage');
    simulation.state.speed = 30;
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

test('考评进度按真实状态核对呼唤、有级位制动、单缓和目标级位顺序', () => {
  const simulation = new SpeedRegulationSimulation('oneStage');
  const assessment = new SpeedRegulationAssessment(simulation);
  simulation.start();
  simulation.command('callout');
  simulation.state.signal = SCENARIOS.oneStage.signals[1];
  simulation.command('callout');
  simulation.state.signal = SCENARIOS.oneStage.signals[2];
  simulation.command('callout');
  simulation.command('side-release', true);
  simulation.command('auto-brake', 1);
  assert.equal(assessment.progress().done, 4);
  simulation.command('lkj-open');
  assert.equal(assessment.progress().done, 5);
  for (let index = 0; index < 110; index += 1) simulation.tick(.05);
  simulation.command('traction', 4);
  for (let index = 0; index < 12; index += 1) simulation.tick(.05);
  assert.equal(assessment.progress().done, 6);
});

test('制动事件保存有级位与单缓状态，常用制动初期牵引电流限制在200A以下', () => {
  const simulation = new SpeedRegulationSimulation('oneStage');
  simulation.start();
  simulation.command('side-release', true);
  simulation.command('auto-brake', 2);
  const brake = simulation.state.events.find((event) => event.type === 'auto-brake');
  assert.equal(brake.traction, 11);
  assert.equal(brake.sideRelease, true);
  for (let index = 0; index < 80; index += 1) simulation.tick(.05);
  assert.ok(simulation.state.tractionForce > 0);
  assert.ok(simulation.state.tractionCurrent <= 200);
  simulation.command('traction', 4);
  for (let index = 0; index < 20; index += 1) simulation.tick(.05);
  assert.equal(simulation.state.tractionForce, 0);
  assert.ok(simulation.state.maxShockIndex > 0);
  const maximum = simulation.state.maxShockIndex;
  simulation.command('shock-reset');
  assert.equal(simulation.state.shockStickFallen, 0);
  assert.equal(simulation.state.maxShockIndex, maximum);
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
  simulation.command('traction', 12);
  for (let index = 0; index < 12_000 && !simulation.state.completed && simulation.state.distance < 4800; index += 1) simulation.tick(.05);
  assert.ok(simulation.state.events.some((event) => event.type === 'lkj-level' && ['service', 'emergency'].includes(event.to)));
  if (simulation.state.entrySpeed != null) {
    const result = new SpeedRegulationAssessment(simulation).result();
    assert.equal(result.redline, true);
    assert.equal(result.qualified, false);
  }
});
