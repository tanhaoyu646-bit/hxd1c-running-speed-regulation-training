import { BRAKE_POSITIONS, getScenario, lkjCurvesAt, phaseAt, signalAt } from './speedRegulationConfig.js';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export class SpeedRegulationSimulation extends EventTarget {
  constructor(scenarioId = 'oneStage') {
    super();
    this.reset(scenarioId);
  }

  reset(scenarioId = this.state?.scenarioId || 'oneStage') {
    const scenario = getScenario(scenarioId);
    const initialLkjCurves = lkjCurvesAt(scenario, 0);
    this.scenario = scenario;
    this.state = {
      scenarioId: scenario.id,
      mode: 'assessment',
      status: 'ready',
      elapsed: 0,
      distance: 0,
      speed: scenario.initialSpeed,
      acceleration: 0,
      traction: scenario.initialTraction,
      direction: 'F',
      autoBrake: 0,
      independentBrake: 0,
      sideRelease: false,
      equalizingReservoir: 600,
      trainPipe: 600,
      tailPipe: 600,
      pipeRechargeRecorded: false,
      brakeCylinder: 0,
      locomotiveCylinder: 0,
      mainReservoir: 900,
      netVoltage: 2500,
      tractionCurrent: 0,
      tractionForce: 0,
      electricBrakeForce: 0,
      grade: 0,
      signal: signalAt(scenario, 0),
      phase: phaseAt(scenario, 0),
      lkjLineLimit: initialLkjCurves.lineLimit,
      lkjModeLimit: initialLkjCurves.modeLimit,
      lkjLimit: initialLkjCurves.activeLimit,
      lkjLevel: 'normal',
      lkjAcknowledged: true,
      lkjForcedBrake: 0,
      lkjOpenCount: 0,
      hornActive: false,
      calloutCount: 0,
      entrySpeed: null,
      completed: false,
      qualified: null,
      events: [],
      samples: [{
        elapsed: 0,
        distance: 0,
        speed: scenario.initialSpeed,
        lineLimit: initialLkjCurves.lineLimit,
        modeLimit: initialLkjCurves.modeLimit,
        limit: initialLkjCurves.activeLimit,
        pipe: 600,
        brake: 0,
        traction: scenario.initialTraction,
      }],
    };
    this.lastSampleAt = -1;
    this.dispatchEvent(new CustomEvent('reset', { detail: this.state }));
    return this.state;
  }

  start() {
    if (this.state.status === 'ready') {
      this.state.status = 'running';
      this.log('attempt-start', { scenarioId: this.state.scenarioId });
      this.emitChange();
    }
  }

  command(type, value) {
    const s = this.state;
    if (s.completed) return false;
    if (s.status === 'ready' && type !== 'lkj-open') this.start();
    const previous = { traction: s.traction, autoBrake: s.autoBrake, independentBrake: s.independentBrake };
    if (type === 'traction') s.traction = clamp(Math.round(Number(value) || 0), -8, 7);
    else if (type === 'auto-brake') s.autoBrake = clamp(Math.round(Number(value) || 0), 0, 5);
    else if (type === 'independent-brake') s.independentBrake = clamp(Math.round(Number(value) || 0), 0, 5);
    else if (type === 'side-release') s.sideRelease = Boolean(value);
    else if (type === 'direction') {
      if (s.speed > 1) this.log('direction-while-moving', { value });
      s.direction = value;
    } else if (type === 'callout') {
      s.calloutCount += 1;
      this.log('callout', { signal: s.signal.id, aspect: s.signal.aspect });
    } else if (type === 'lkj-open') {
      s.lkjOpenCount += 1;
      this.log('lkj-open');
    } else if (type === 'horn-start' || type === 'horn-stop') {
      s.hornActive = type === 'horn-start';
      this.log(type);
    } else if (type === 'cir-action') {
      this.log('cir-action', { action: value });
    } else if (type === 'lkj-ack') {
      s.lkjAcknowledged = true;
      this.log('lkj-ack', { level: s.lkjLevel });
    } else if (type === 'lkj-relief') {
      if (s.lkjLevel === 'normal' && s.speed <= s.lkjLimit + 1) {
        s.lkjForcedBrake = 0;
        this.log('lkj-relief', { accepted: true });
      } else this.log('lkj-relief', { accepted: false });
    } else if (type === 'lkj-start-align') {
      this.log('lkj-start-align');
    } else if (type === 'lkj-position-correct') {
      this.log('lkj-position-correct', { method: value || 'auto' });
    } else if (type === 'lkj-mark') {
      this.log('lkj-mark');
    } else if (type === 'lkj-patrol') {
      this.log('lkj-patrol');
    } else return false;
    if (['traction', 'auto-brake', 'independent-brake', 'side-release'].includes(type)) {
      this.log(type, { value: type === 'side-release' ? s.sideRelease : s[type === 'auto-brake' ? 'autoBrake' : type === 'independent-brake' ? 'independentBrake' : 'traction'], previous });
    }
    this.emitChange();
    return true;
  }

  log(type, data = {}) {
    this.state.events.push({ type, elapsed: this.state.elapsed, distance: this.state.distance, speed: this.state.speed, ...data });
  }

  tick(dt) {
    const s = this.state;
    if (s.status !== 'running' || s.completed) return;
    dt = clamp(Number(dt) || 0, 0, 0.08);
    s.elapsed += dt;
    const requestedReduction = BRAKE_POSITIONS[Math.max(s.autoBrake, s.lkjForcedBrake)]?.reduction || 0;
    const targetPipe = Math.max(0, 600 - requestedReduction);
    const pipeTau = targetPipe < s.trainPipe ? 6.6 : 14.0;
    s.trainPipe += (targetPipe - s.trainPipe) * (1 - Math.exp(-dt / pipeTau));
    s.tailPipe += (s.trainPipe - s.tailPipe) * (1 - Math.exp(-dt / 2.2));
    const rechargeWindow = this.scenario.rechargeWindow || [1800, 3400];
    if (s.autoBrake === 0 && s.trainPipe >= 590 && s.distance > rechargeWindow[0] && s.distance < rechargeWindow[1] && !s.pipeRechargeRecorded) {
      s.pipeRechargeRecorded = true;
      this.log('pipe-recharged', { pipe: s.trainPipe });
    }
    s.equalizingReservoir += (targetPipe - s.equalizingReservoir) * (1 - Math.exp(-dt / 2.8));
    const automaticCylinder = clamp((600 - s.trainPipe) / 170 * 350, 0, 430);
    const independentCylinder = s.independentBrake * 62;
    s.brakeCylinder += (Math.max(automaticCylinder, independentCylinder) - s.brakeCylinder) * (1 - Math.exp(-dt / 2.4));
    const desiredLoco = s.sideRelease ? independentCylinder : Math.max(automaticCylinder, independentCylinder);
    s.locomotiveCylinder += (desiredLoco - s.locomotiveCylinder) * (1 - Math.exp(-dt / 1.5));

    const speedMps = s.speed / 3.6;
    const tractionForce = s.traction > 0 && s.autoBrake === 0 && s.lkjForcedBrake === 0 && s.lkjLevel !== 'unload'
      ? s.traction * 38_000 * clamp(1.18 - s.speed / 210, 0.48, 1.1)
      : 0;
    const electricBrake = s.traction < 0 ? Math.abs(s.traction) * 42_000 : 0;
    s.tractionForce = tractionForce;
    s.electricBrakeForce = electricBrake;
    const targetCurrent = clamp((tractionForce || electricBrake) / 310, 0, 900);
    s.tractionCurrent += (targetCurrent - s.tractionCurrent) * (1 - Math.exp(-dt / 0.45));
    s.netVoltage += (clamp(2500 - s.tractionCurrent * 0.12, 2200, 2600) - s.netVoltage) * (1 - Math.exp(-dt / 2));
    s.mainReservoir += (clamp(900 - Math.max(0, 600 - s.trainPipe) * 0.07, 820, 900) - s.mainReservoir) * (1 - Math.exp(-dt / 5));
    const rollingResistance = 30_000 + speedMps * speedMps * 10;
    // 按“标准旅客列车”校准：50 kPa 初减压用于两段制动的第二段，
    // 一段制动若减速不足则需要追加减压，不能用同一制动力硬套两个技能。
    const pneumaticForce = s.brakeCylinder * 1_200;
    const gradeForce = 900_000 * 9.81 * clamp(s.grade, -20, 20) / 1000;
    const netForce = tractionForce - electricBrake - rollingResistance - pneumaticForce - gradeForce;
    const newAcceleration = netForce / 900_000;
    s.acceleration += (newAcceleration - s.acceleration) * (1 - Math.exp(-dt / 0.7));
    s.speed = Math.max(0, s.speed + s.acceleration * dt * 3.6);
    s.distance += s.speed / 3.6 * dt;
    s.phase = phaseAt(this.scenario, s.distance);
    s.signal = signalAt(this.scenario, s.distance);
    const lkjCurves = lkjCurvesAt(this.scenario, s.distance);
    s.lkjLineLimit = lkjCurves.lineLimit;
    s.lkjModeLimit = lkjCurves.modeLimit;
    s.lkjLimit = lkjCurves.activeLimit;
    this.updateLkjProtection();

    if (s.elapsed - this.lastSampleAt >= 0.5) {
      this.lastSampleAt = s.elapsed;
      s.samples.push({ elapsed: s.elapsed, distance: s.distance, speed: s.speed, lineLimit: s.lkjLineLimit, modeLimit: s.lkjModeLimit, limit: s.lkjLimit, pipe: s.trainPipe, brake: s.autoBrake, traction: s.traction });
      if (s.samples.length > 900) s.samples.shift();
    }
    if (s.entrySpeed == null && s.distance >= this.scenario.entryDistance) {
      s.entrySpeed = s.speed;
      this.log('entry-pass', { entrySpeed: s.speed });
      if (s.speed > this.scenario.maximumEntrySpeed) {
        s.qualified = false;
        s.lkjForcedBrake = s.speed > this.scenario.maximumEntrySpeed + 8 ? 5 : 3;
        this.log('entry-overspeed', { limit: this.scenario.maximumEntrySpeed });
      }
    }
    if (s.distance >= this.scenario.finishDistance || (s.entrySpeed != null && s.speed < 2)) {
      s.completed = true;
      s.status = 'completed';
      if (s.qualified == null) s.qualified = true;
      this.log('attempt-complete');
      this.dispatchEvent(new CustomEvent('complete', { detail: s }));
    }
    this.emitChange();
  }

  updateLkjProtection() {
    const s = this.state;
    const excess = s.speed - s.lkjLimit;
    const previous = s.lkjLevel;
    if (excess >= 8) { s.lkjLevel = 'emergency'; s.lkjForcedBrake = 5; }
    else if (excess >= 5) { s.lkjLevel = 'service'; s.lkjForcedBrake = Math.max(s.lkjForcedBrake, 3); }
    else if (excess >= 3) s.lkjLevel = 'unload';
    else if (excess >= 2) s.lkjLevel = 'warning';
    else s.lkjLevel = 'normal';
    if (s.lkjLevel !== previous) {
      if (s.lkjLevel !== 'normal') s.lkjAcknowledged = false;
      this.log('lkj-level', { from: previous, to: s.lkjLevel, excess });
    }
  }

  emitChange() {
    this.dispatchEvent(new CustomEvent('change', { detail: this.state }));
  }
}
