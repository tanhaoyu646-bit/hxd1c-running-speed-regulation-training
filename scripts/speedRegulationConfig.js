export const PROJECT_ID = 'hxd1c-running-speed-regulation-v1';

export const CAB = Object.freeze({ width: 640, height: 480 });

export const SPEED_ROUTE_WINDOW = Object.freeze({
  start: 23_500,
  end: 29_650,
  lateral: 650,
});

export const SCENARIOS = Object.freeze({
  oneStage: Object.freeze({
    id: 'oneStage',
    title: '途中一段制动调速',
    shortTitle: '一段制动',
    initialSpeed: 115,
    initialTraction: 2,
    startOffset: 26880,
    routeWindow: SPEED_ROUTE_WINDOW,
    entryDistance: 2000,
    finishDistance: 2050,
    targetSpeed: 40,
    maximumEntrySpeed: 45,
    stationName: '前方车站',
    entrySignalName: 'K226+091 进站信号机',
    routeLabel: '区间—车站进站',
    signals: [
      { id: 'approach', label: '接近信号机', distance: 520, aspect: 'green-yellow' },
      { id: 'entry', label: 'K226+091 进站信号机', distance: 2000, aspect: 'double-yellow' },
    ],
    phases: [
      { id: 'prepare', start: 0, end: 520, label: '接近区段' },
      { id: 'braking', start: 520, end: 1750, label: '制动调速区段' },
      { id: 'entry', start: 1750, end: 2050, label: '进站信号机前' },
    ],
  }),
  twoStage: Object.freeze({
    id: 'twoStage',
    title: '途中两段制动调速',
    shortTitle: '两段制动',
    initialSpeed: 120,
    initialTraction: 2,
    startOffset: 24380,
    routeWindow: SPEED_ROUTE_WINDOW,
    entryDistance: 4500,
    finishDistance: 4550,
    targetSpeed: 40,
    maximumEntrySpeed: 45,
    stationName: '前方车站',
    entrySignalName: 'K226+091 进站信号机',
    routeLabel: '区间—车站进站',
    signals: [
      { id: 'first-approach', label: '第一接近信号机', distance: 820, aspect: 'green-yellow' },
      { id: 'third-approach', label: '第三接近信号机', distance: 3040, aspect: 'double-yellow' },
      { id: 'entry', label: 'K226+091 进站信号机', distance: 4500, aspect: 'double-yellow' },
    ],
    phases: [
      { id: 'first', start: 0, end: 1500, label: '第一制动区段' },
      { id: 'recharge', start: 1500, end: 3040, label: '缓解充风区段' },
      { id: 'second', start: 3040, end: 4250, label: '第二制动区段' },
      { id: 'entry', start: 4250, end: 4550, label: '进站信号机前' },
    ],
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
  return [...scenario.signals].reverse().find((signal) => distance >= signal.distance - 140) || {
    id: 'clear', label: '区间信号', distance: 0, aspect: 'green',
  };
}

export function lkjControlLimit(scenario, distance) {
  const remaining = Math.max(0, scenario.entryDistance - distance);
  const entryMps = scenario.maximumEntrySpeed / 3.6;
  const serviceDeceleration = 0.42;
  const curve = Math.sqrt(entryMps ** 2 + 2 * serviceDeceleration * remaining) * 3.6;
  return Math.max(scenario.maximumEntrySpeed, Math.min(120, curve));
}
