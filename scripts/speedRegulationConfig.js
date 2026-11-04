export const PROJECT_ID = 'hxd1c-running-speed-regulation-v1';

export const CAB = Object.freeze({ width: 640, height: 480 });

// 与“坡道驾驶调速”项目保持同一主手柄给定逻辑：正级位对应目标速度，
// 实际速度达到或超过该级位目标后不再输出牵引力。
export const TRACTION_MAX = 12;
export const DYNAMIC_BRAKE_MAX = 8;
export const TRAINING_GRADE_PERMILLE = 0;
export const TRACTION_TARGET_SPEEDS = Object.freeze([0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120]);

export function tractionTargetSpeed(notch) {
  return TRACTION_TARGET_SPEEDS[Math.max(0, Math.min(TRACTION_MAX, Math.round(Number(notch) || 0)))] || 0;
}

export const SPEED_ROUTE_WINDOW = Object.freeze({
  start: 23_500,
  // 保留大山铺前桥梁、邻线以及 30.24–31.86 km 原生隧道的完整世界块。
  end: 32_050,
  lateral: 650,
});

// 线路附属设施的里程直接使用当前 NEIYI TrackDB 路径累计距离。
// LKJ 与三维场景都以 scenario.startOffset 为零点，避免桥隧标记和车外画面各自硬编码。
export const ROUTE_INFRASTRUCTURE = Object.freeze([
  Object.freeze({ id: 'west-bridge', type: 'bridge', label: '桥梁', start: 23_990, end: 24_380 }),
  Object.freeze({ id: 'dashanpu-bridge', type: 'bridge', label: '大山铺桥', start: 27_004, end: 27_360 }),
  Object.freeze({ id: 'neiyi-tunnel', type: 'tunnel', label: '隧道', start: 30_229, end: 31_839 }),
]);

const commonLkj = Object.freeze({
  lineName: '内宜线',
  sectionCode: '226',
  trainNumber: '57001',
  trainKind: '客本',
  trainWeight: 900,
  carCount: 18,
  trainLength: 42.0,
  speedGrade: 120,
  locomotive: 'HXD1C',
});

export const SCENARIOS = Object.freeze({
  oneStage: Object.freeze({
    id: 'oneStage',
    title: '途中一段制动调速',
    shortTitle: '一段制动',
    initialSpeed: 110,
    initialTraction: 11,
    operatingGrade: TRAINING_GRADE_PERMILLE,
    // 起点位于进站前第二架通过信号机外方，完整保留两个自动闭塞分区。
    startOffset: 23880,
    routeWindow: SPEED_ROUTE_WINDOW,
    entryDistance: 5000,
    // 通过进站信号机后继续运行600 m，再结束本轮考评。
    finishDistance: 5600,
    targetSpeed: 40,
    brakeTargetNotches: Object.freeze([4]),
    // 一次制动允许初次减压、最多两次追加和一次缓解；只统计真实级位变化。
    autoBrakeMoveLimit: 4,
    // 保留现有信号机里程，制动时机统一按信号机相对距离考核。
    brakeWindows: Object.freeze([
      Object.freeze({ signalId: 'second-through', offsetMin: 550, offsetMax: 750, label: '第二接近通过信号机后550—750 m' }),
    ]),
    maximumEntrySpeed: 45,
    stationName: '前方车站',
    entrySignalName: 'K226+091 进站信号机',
    routeLabel: '区间—车站进站',
    lkj: Object.freeze({ ...commonLkj, startKilometer: 221.091 }),
    lineLimits: Object.freeze([
      Object.freeze({ start: -1_500, end: 5000, limit: 120 }),
      Object.freeze({ start: 5000, end: 5700, limit: 80 }),
      Object.freeze({ start: 5700, end: 10_000, limit: 120 }),
    ]),
    controlTargets: Object.freeze([
      Object.freeze({ distance: 5000, speed: 45, holdUntil: 5600, serviceDeceleration: 0.42 }),
    ]),
    signals: [
      { id: 'second-through', label: '进站前第二架通过信号机', distance: 1320, aspect: 'green-yellow' },
      { id: 'first-through', label: '进站前第一架通过信号机', distance: 3540, aspect: 'yellow' },
      { id: 'entry', label: 'K226+091 进站信号机', distance: 5000, aspect: 'double-yellow' },
    ],
    phases: [
      { id: 'prepare', start: 0, end: 1320, label: '第二架通过信号机外方' },
      { id: 'second-through', start: 1320, end: 3000, label: '第二接近闭塞分区' },
      { id: 'braking', start: 3000, end: 4750, label: '第一接近制动调速区段' },
      { id: 'entry', start: 4750, end: 5000, label: '进站信号机前' },
      { id: 'station', start: 5000, end: 5600, label: '站内继续运行考核段' },
    ],
  }),
  twoStage: Object.freeze({
    id: 'twoStage',
    title: '途中两段制动调速',
    shortTitle: '两段制动',
    initialSpeed: 110,
    initialTraction: 11,
    operatingGrade: TRAINING_GRADE_PERMILLE,
    // 同样从第二架通过信号机外方开始；两个技能共用同一组实际信号位置。
    startOffset: 23880,
    routeWindow: SPEED_ROUTE_WINDOW,
    entryDistance: 5000,
    // 通过进站信号机后继续运行600 m，再结束本轮考评。
    finishDistance: 5600,
    targetSpeed: 40,
    brakeTargetNotches: Object.freeze([9, 4]),
    // 两次制动各允许初次减压、一次追加和一次缓解；只统计真实级位变化。
    autoBrakeMoveLimit: 6,
    brakeWindows: Object.freeze([
      Object.freeze({ signalId: 'second-through', offsetMin: 0, offsetMax: 200, label: '第二接近通过信号机后0—200 m' }),
      Object.freeze({ signalId: 'first-through', offsetMin: -240, offsetMax: -40, label: '第一接近通过信号机前240—40 m' }),
    ]),
    maximumEntrySpeed: 45,
    stationName: '前方车站',
    entrySignalName: 'K226+091 进站信号机',
    routeLabel: '区间—车站进站',
    lkj: Object.freeze({ ...commonLkj, startKilometer: 221.091 }),
    lineLimits: Object.freeze([
      Object.freeze({ start: -1_500, end: 5000, limit: 120 }),
      Object.freeze({ start: 5000, end: 5700, limit: 80 }),
      Object.freeze({ start: 5700, end: 10_000, limit: 120 }),
    ]),
    controlTargets: Object.freeze([
      Object.freeze({ distance: 5000, speed: 45, holdUntil: 5600, serviceDeceleration: 0.42 }),
    ]),
    signals: [
      { id: 'second-through', label: '进站前第二架通过信号机', distance: 1320, aspect: 'green-yellow' },
      { id: 'first-through', label: '进站前第一架通过信号机', distance: 3540, aspect: 'yellow' },
      { id: 'entry', label: 'K226+091 进站信号机', distance: 5000, aspect: 'double-yellow' },
    ],
    phases: [
      { id: 'prepare', start: 0, end: 700, label: '第二架通过信号机外方' },
      { id: 'first', start: 700, end: 2000, label: '第二接近第一次制动区段' },
      { id: 'recharge', start: 2000, end: 3300, label: '缓解充风区段' },
      { id: 'second', start: 3300, end: 4750, label: '第一接近第二次制动区段' },
      { id: 'entry', start: 4750, end: 5000, label: '进站信号机前' },
      { id: 'station', start: 5000, end: 5600, label: '站内继续运行考核段' },
    ],
    rechargeWindow: Object.freeze([2300, 3900]),
  }),
});

export const BRAKE_POSITIONS = Object.freeze([
  { value: 0, label: '运转位', reduction: 0 },
  { value: 1, label: '初制位', reduction: 50 },
  { value: 2, label: '常用Ⅱ', reduction: 90 },
  { value: 3, label: '常用Ⅲ', reduction: 130 },
  { value: 4, label: '常用Ⅳ', reduction: 170 },
  { value: 5, label: '紧急位', reduction: 600 },
]);

export const LKJ_KEYS = Object.freeze([
  ['alarm','警惕',12,533,61,59],
  ['unlock','解锁',91,520,62,40],['relief','缓解',91,563,62,40],
  ['digit-1','向前／1',161,520,63,40],['digit-6','向后／6',161,563,63,40],
  ['digit-2','调车／2',231,520,63,40],['digit-7','开车／7',231,563,63,40],
  ['digit-3','车位／3',301,520,63,40],['digit-8','自动校正／8',301,563,63,40],
  ['digit-4','进路号／4',371,520,63,40],['digit-9','出入库／9',371,563,63,40],
  ['digit-5','定标／5',441,520,63,40],['digit-0','巡检／0',441,563,63,40],
  ['query','查询',511,520,63,40],['left','左箭头／删除',511,563,63,40],
  ['up','上箭头',581,520,63,40],['down','下箭头',581,563,63,40],
  ['dump','转储',651,520,63,40],['right','右箭头',651,563,63,40],
  ['setting','设定',721,520,63,40],['confirm','确认',721,563,63,40],
]);

export function getScenario(id) {
  return SCENARIOS[id] || SCENARIOS.oneStage;
}

export function phaseAt(scenario, distance) {
  return scenario.phases.find((phase) => distance >= phase.start && distance < phase.end)
    || scenario.phases.at(-1);
}

export function signalAt(scenario, distance) {
  return scenario.signals.find((signal) => distance < signal.distance) || {
    id: 'clear', label: '通过进站信号机', distance, aspect: 'green',
  };
}

export function lineLimitAt(scenario, distance) {
  return scenario.lineLimits?.find((segment) => distance >= segment.start && distance < segment.end)?.limit
    ?? scenario.lkj?.speedGrade
    ?? 120;
}

export function lkjCurvesAt(scenario, distance) {
  const lineLimit = lineLimitAt(scenario, distance);
  let modeLimit = scenario.lkj?.speedGrade ?? 120;
  for (const target of scenario.controlTargets || []) {
    if (distance > target.holdUntil) continue;
    if (distance >= target.distance) {
      modeLimit = Math.min(modeLimit, target.speed);
      continue;
    }
    const remaining = target.distance - distance;
    const targetMps = target.speed / 3.6;
    const deceleration = target.serviceDeceleration || 0.42;
    const envelope = Math.sqrt(targetMps ** 2 + 2 * deceleration * remaining) * 3.6;
    modeLimit = Math.min(modeLimit, Math.max(target.speed, envelope));
  }
  modeLimit = Math.min(scenario.lkj?.speedGrade ?? 120, modeLimit);
  return { lineLimit, modeLimit, activeLimit: Math.min(lineLimit, modeLimit) };
}

export function lkjControlLimit(scenario, distance) {
  return lkjCurvesAt(scenario, distance).activeLimit;
}

export function routeFacilitiesForScenario(scenario) {
  return ROUTE_INFRASTRUCTURE.map((facility) => Object.freeze({
    ...facility,
    start: facility.start - scenario.startOffset,
    end: facility.end - scenario.startOffset,
  }));
}

export function absoluteKilometerAt(scenario, distance) {
  return (scenario.lkj?.startKilometer || 0) + Math.max(0, Number(distance) || 0) / 1000;
}
