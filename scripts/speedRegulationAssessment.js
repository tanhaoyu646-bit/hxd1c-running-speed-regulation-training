const last = (items) => items.at(-1);
const between = (value, min, max) => value >= min && value <= max;

export class SpeedRegulationAssessment {
  constructor(simulation) {
    this.simulation = simulation;
  }

  progress(state = this.simulation.state) {
    const events = state.events;
    const scenario = this.simulation.scenario;
    const checks = [
      events.some((event) => event.type === 'lkj-open'),
      events.some((event) => event.type === 'callout'),
      events.some((event) => event.type === 'traction' && event.value === 0),
      events.some((event) => event.type === 'side-release' && event.value),
      events.some((event) => event.type === 'auto-brake' && event.value > 0),
    ];
    if (scenario.id === 'twoStage') {
      checks.push(
        events.some((event) => event.type === 'auto-brake' && event.value === 0 && event.speed < 98),
        state.samples.some((sample) => sample.distance > 1800 && sample.pipe >= 590),
        events.filter((event) => event.type === 'auto-brake' && event.value > 0).length >= 2,
      );
    }
    checks.push(state.entrySpeed != null, state.completed);
    return { done: checks.filter(Boolean).length, total: checks.length, checks };
  }

  result(state = this.simulation.state) {
    const events = state.events;
    const scenario = this.simulation.scenario;
    const firstBrake = events.find((event) => event.type === 'auto-brake' && event.value > 0);
    const brakeApplications = events.filter((event) => event.type === 'auto-brake' && event.value > 0 && event.previous?.autoBrake === 0);
    const releases = events.filter((event) => event.type === 'auto-brake' && event.value === 0);
    const sideRelease = events.find((event) => event.type === 'side-release' && event.value);
    const tractionZero = events.find((event) => event.type === 'traction' && event.value === 0);
    const safetyEvents = events.filter((event) => event.type === 'entry-overspeed' || (event.type === 'lkj-level' && ['service', 'emergency'].includes(event.to)));

    let observation = 15;
    if (!events.some((event) => event.type === 'lkj-open')) observation -= 5;
    if (!events.some((event) => event.type === 'callout')) observation -= 5;
    if (!events.some((event) => event.type === 'lkj-ack') && events.some((event) => event.type === 'lkj-level' && event.to === 'warning')) observation -= 5;

    let preparation = 15;
    if (!tractionZero || (firstBrake && tractionZero.elapsed > firstBrake.elapsed)) preparation -= 8;
    if (!sideRelease || (firstBrake && Math.abs(sideRelease.distance - firstBrake.distance) > 450)) preparation -= 7;

    let timing = 20;
    if (!firstBrake) timing = 0;
    else if (scenario.id === 'oneStage') {
      if (!between(firstBrake.distance, 100, 750)) timing -= 10;
      if (!between(firstBrake.value, 1, 2)) timing -= 5;
    } else {
      if (!between(firstBrake.distance, 600, 1250)) timing -= 6;
      const firstRelease = releases.find((event) => event.elapsed > firstBrake.elapsed);
      if (!firstRelease || !between(firstRelease.speed, 86, 97)) timing -= 6;
      const secondBrake = brakeApplications[1];
      if (!secondBrake || !between(secondBrake.distance, 2850, 3550)) timing -= 8;
    }

    let technique = 20;
    if (events.some((event) => event.type === 'auto-brake' && event.value >= 4)) technique -= 8;
    if (events.filter((event) => event.type === 'auto-brake').length > 9) technique -= 5;
    if (scenario.id === 'twoStage') {
      const recharge = state.samples.some((sample) => sample.distance > 1800 && sample.distance < 3400 && sample.pipe >= 590);
      if (!recharge) technique -= 7;
    }

    let target = 20;
    if (state.entrySpeed == null) target = 0;
    else if (state.entrySpeed > scenario.maximumEntrySpeed) target = 0;
    else if (!between(state.entrySpeed, 35, 43)) target -= 5;

    let smoothness = 10;
    const maxDeceleration = Math.abs(Math.min(0, ...state.samples.slice(-300).map((sample, index, list) => index ? ((sample.speed - list[index - 1].speed) / Math.max(.1, sample.elapsed - list[index - 1].elapsed)) / 3.6 : 0)));
    if (maxDeceleration > 0.9) smoothness -= 5;
    if (events.some((event) => event.type === 'direction-while-moving')) smoothness = 0;

    const categories = [
      { name: '瞭望与呼唤', score: Math.max(0, observation), maximum: 15 },
      { name: '制动前准备', score: Math.max(0, preparation), maximum: 15 },
      { name: '制动时机', score: Math.max(0, timing), maximum: 20 },
      { name: '制动与充风操作', score: Math.max(0, technique), maximum: 20 },
      { name: '进站速度控制', score: Math.max(0, target), maximum: 20 },
      { name: '平稳操纵', score: Math.max(0, smoothness), maximum: 10 },
    ];
    let score = categories.reduce((sum, category) => sum + category.score, 0);
    const redline = safetyEvents.length > 0;
    if (redline) score = Math.min(score, 59);
    const qualified = !redline && score >= 80 && state.entrySpeed <= scenario.maximumEntrySpeed;
    return {
      score,
      qualified,
      redline,
      categories,
      entrySpeed: state.entrySpeed,
      duration: state.elapsed,
      distance: state.distance,
      summary: qualified ? '考评合格' : '考评不合格',
      safetyEvents,
      finalEvent: last(events),
    };
  }
}
