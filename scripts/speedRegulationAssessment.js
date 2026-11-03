const last = (items) => items.at(-1);
const between = (value, min, max) => value >= min && value <= max;

function brakeApplications(events) {
  return events.filter((event) => event.type === 'auto-brake'
    && event.value > 0
    && event.previous?.autoBrake === 0);
}

function preparedForBrake(event) {
  return Boolean(event) && event.traction === 0 && event.sideRelease === true;
}

function signalCallouts(events, scenario) {
  const called = new Set(events.filter((event) => event.type === 'callout').map((event) => event.signal));
  return scenario.signals.map((signal) => ({ ...signal, done: called.has(signal.id) }));
}

export class SpeedRegulationAssessment {
  constructor(simulation) {
    this.simulation = simulation;
  }

  progress(state = this.simulation.state) {
    const events = state.events;
    const scenario = this.simulation.scenario;
    const applications = brakeApplications(events);
    const firstBrake = applications[0];
    const calls = signalCallouts(events, scenario);
    const tractionZeroBeforeFirst = events.some((event) => event.type === 'traction' && event.value === 0
      && (!firstBrake || event.elapsed <= firstBrake.elapsed));
    const checks = [
      events.some((event) => event.type === 'lkj-open'),
      calls.every((item) => item.done),
      tractionZeroBeforeFirst,
      firstBrake?.sideRelease === true,
      Boolean(firstBrake),
    ];
    if (scenario.id === 'twoStage') {
      const firstRelease = events.find((event) => event.type === 'auto-brake' && event.value === 0
        && firstBrake && event.elapsed > firstBrake.elapsed);
      checks.push(Boolean(firstRelease), events.some((event) => event.type === 'pipe-recharged'));
      checks.push(preparedForBrake(applications[1]), Boolean(applications[1]));
    }
    checks.push(events.some((event) => event.type === 'entry-pass'));
    checks.push(events.some((event) => event.type === 'attempt-complete'));
    const current = checks.findIndex((check) => !check);
    return {
      done: checks.filter(Boolean).length,
      total: checks.length,
      current: current < 0 ? checks.length : current,
      checks,
      calloutDone: calls.filter((item) => item.done).length,
      calloutTotal: calls.length,
    };
  }

  result(state = this.simulation.state) {
    const events = state.events;
    const scenario = this.simulation.scenario;
    const applications = brakeApplications(events);
    const firstBrake = applications[0];
    const secondBrake = applications[1];
    const releases = events.filter((event) => event.type === 'auto-brake' && event.value === 0);
    const calls = signalCallouts(events, scenario);
    const safetyEvents = events.filter((event) => event.type === 'entry-overspeed'
      || (event.type === 'lkj-level' && ['service', 'emergency'].includes(event.to))
      || event.type === 'direction-while-moving');

    const observationNotes = [];
    let observation = 15;
    if (!events.some((event) => event.type === 'lkj-open')) {
      observation -= 3;
      observationNotes.push('未查看LKJ');
    }
    for (const signal of calls) {
      if (!signal.done) {
        observation -= 4;
        observationNotes.push(`漏呼${signal.label}`);
      }
    }

    const preparationNotes = [];
    let preparation = 15;
    if (!firstBrake || firstBrake.traction !== 0) {
      preparation -= 8;
      preparationNotes.push('首次空气制动前牵引手柄未回零');
    }
    if (!firstBrake || firstBrake.sideRelease !== true) {
      preparation -= 7;
      preparationNotes.push('首次空气制动时未实施单缓');
    }

    const timingNotes = [];
    let timing = 20;
    if (!firstBrake) {
      timing = 0;
      timingNotes.push('未形成有效制动作用');
    } else if (scenario.id === 'oneStage') {
      if (!between(firstBrake.distance, 2950, 3650)) {
        timing -= 12;
        timingNotes.push('一段制动时机超出2950—3650 m考核窗');
      }
      if (!between(firstBrake.value, 1, 2)) {
        timing -= 8;
        timingNotes.push('初次减压级位不符合初制至常用Ⅱ');
      }
    } else {
      if (!between(firstBrake.distance, 1050, 1800)) {
        timing -= 6;
        timingNotes.push('第一段制动时机超出1050—1800 m考核窗');
      }
      const firstRelease = releases.find((event) => event.elapsed > firstBrake.elapsed);
      if (!firstRelease || !between(firstRelease.speed, 86, 97)) {
        timing -= 6;
        timingNotes.push('第一段缓解速度不在86—97 km/h');
      }
      if (!secondBrake || !between(secondBrake.distance, 3300, 4050)) {
        timing -= 8;
        timingNotes.push('第二段制动时机超出3300—4050 m考核窗');
      }
    }

    const techniqueNotes = [];
    let technique = 20;
    if (events.some((event) => event.type === 'auto-brake' && event.value >= 4)) {
      technique -= 6;
      techniqueNotes.push('出现常用Ⅳ或紧急级位');
    }
    if (events.filter((event) => event.type === 'auto-brake').length > 9) {
      technique -= 4;
      techniqueNotes.push('自阀往复调整次数过多');
    }
    if (scenario.id === 'oneStage' && applications.length > 1) {
      technique -= 4;
      techniqueNotes.push('一段制动中出现再次制动作用');
    }
    if (scenario.id === 'twoStage') {
      const rechargeWindow = scenario.rechargeWindow || [1800, 3400];
      const recharge = state.samples.some((sample) => sample.distance > rechargeWindow[0]
        && sample.distance < rechargeWindow[1] && sample.pipe >= 590);
      if (!recharge) {
        technique -= 6;
        techniqueNotes.push('两段间列车管未充分充风');
      }
      if (!secondBrake || secondBrake.traction !== 0) {
        technique -= 2;
        techniqueNotes.push('第二次空气制动前牵引手柄未保持零位');
      }
      if (!secondBrake || secondBrake.sideRelease !== true) {
        technique -= 2;
        techniqueNotes.push('第二次空气制动时未实施单缓');
      }
    }
    const warning = events.some((event) => event.type === 'lkj-level' && event.to === 'warning');
    if (warning && !events.some((event) => event.type === 'lkj-ack')) {
      technique -= 2;
      techniqueNotes.push('LKJ警报未确认');
    }

    const targetNotes = [];
    let target = 20;
    if (state.entrySpeed == null) {
      target = 0;
      targetNotes.push('未形成进站信号机通过速度记录');
    } else if (state.entrySpeed > scenario.maximumEntrySpeed) {
      target = 0;
      targetNotes.push(`进站速度超过${scenario.maximumEntrySpeed} km/h`);
    } else if (!between(state.entrySpeed, 35, 43)) {
      target -= 5;
      targetNotes.push('进站速度未落入35—43 km/h优选区间');
    }

    const smoothnessNotes = [];
    let smoothness = 10;
    const maxShock = Number(state.maxShockIndex) || Math.max(0, ...state.samples.map((sample) => Number(sample.shockIndex) || 0));
    if (maxShock >= 75) {
      smoothness -= 6;
      smoothnessNotes.push(`最大冲动指数${maxShock.toFixed(0)}，操纵冲动明显`);
    } else if (maxShock >= 50) {
      smoothness -= 3;
      smoothnessNotes.push(`最大冲动指数${maxShock.toFixed(0)}，平稳性一般`);
    }
    if (events.some((event) => event.type === 'direction-while-moving')) {
      smoothness = 0;
      smoothnessNotes.push('运行中移动换向手柄');
    }

    const categories = [
      { name: '瞭望与呼唤', score: Math.max(0, observation), maximum: 15, notes: observationNotes },
      { name: '制动前准备', score: Math.max(0, preparation), maximum: 15, notes: preparationNotes },
      { name: '制动时机', score: Math.max(0, timing), maximum: 20, notes: timingNotes },
      { name: '制动与充风操作', score: Math.max(0, technique), maximum: 20, notes: techniqueNotes },
      { name: '进站速度控制', score: Math.max(0, target), maximum: 20, notes: targetNotes },
      { name: '平稳操纵', score: Math.max(0, smoothness), maximum: 10, notes: smoothnessNotes },
    ];
    let score = categories.reduce((sum, category) => sum + category.score, 0);
    const redline = safetyEvents.length > 0;
    if (redline) score = Math.min(score, 59);
    const progress = this.progress(state);
    const sequenceComplete = progress.done === progress.total;
    if (!sequenceComplete) score = Math.min(score, 79);
    const qualified = !redline && sequenceComplete && score >= 80
      && state.entrySpeed != null && state.entrySpeed <= scenario.maximumEntrySpeed;
    return {
      score, qualified, redline, sequenceComplete, categories,
      entrySpeed: state.entrySpeed, duration: state.elapsed, distance: state.distance, maxShock,
      summary: qualified ? '考评合格' : !sequenceComplete ? '考评不合格：规定操作记录未完成' : '考评不合格',
      safetyEvents, finalEvent: last(events),
    };
  }
}
