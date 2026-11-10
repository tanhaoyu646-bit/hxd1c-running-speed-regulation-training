import { CAB, PROJECT_ID, getScenario, lkjControlLimit, TRACTION_MAX } from './speedRegulationConfig.js';
import { SpeedRegulationSimulation } from './speedRegulationSimulation.js?v=20261103-scoring-shock-1';
import { SpeedRegulationAssessment } from './speedRegulationAssessment.js?v=20261103-scoring-shock-1';
import { SpeedRegulationScene } from './speedRegulationScene.js?v=20261103-scoring-catenary-1';
import { LkjRuntime } from './lkjRuntime.js?v=20261103-lkj-curve-scale-1';
import { CirRuntime } from './cirRuntime.js?v=20261103-traction-block-signals-2';
import {
  clearCandidateDraft,
  createCandidateAttempt,
  formatAttemptTime,
  loadCandidateDraft,
  saveCandidateDraft,
  validateCandidate,
} from './speedRegulationCandidate.js';

const $ = (selector) => document.querySelector(selector);
const pct = (value, total) => `${value / total * 100}%`;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const views = { front: 'HXD1C_front.png', left: 'HXD1C_left_full.png', right: 'HXD1C_right_full.png', rearLeft: 'HXD1C_left.png', rearRight: 'HXD1C_right.png' };
const brakeNames = ['运转位', '初制位', '常用Ⅱ', '常用Ⅲ', '常用Ⅳ', '紧急位'];

let simulation = new SpeedRegulationSimulation('oneStage');
let assessment = new SpeedRegulationAssessment(simulation);
let routeScene = null;
let candidateRouteReady = false;
let candidateCabReady = false;
let candidateLoadFailed = false;
let lkj = new LkjRuntime($('#lkj-dock'), simulation);
let cir = new CirRuntime(simulation);
let selectedView = 'front';
let lastFrame = performance.now();
let resultShown = false;
let activeDrag = null;
let lastDragged = { id: '', at: 0 };
let audioContext = null;
let lastAlertLevel = 'normal';
let candidateProfile = null;
let candidateAttempt = null;
const hornAudio = new Audio('./assets/audio/HXD1C-horn.wav');
hornAudio.preload = 'auto';
hornAudio.loop = true;
let hornPointerId = null;
const overlay = $('#cab-overlay');
const elements = {};
const mobileLike = matchMedia('(pointer: coarse)').matches
  || matchMedia('(max-height:620px) and (orientation:landscape)').matches
  || navigator.maxTouchPoints > 0
  || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
if (mobileLike) document.body.classList.add('mobile-controls-enabled');

function preloadRouteScene() {
  const storedScenarioId = localStorage.getItem(`${PROJECT_ID}:last-scenario`);
  const scenario = getScenario(storedScenarioId);
  routeScene = new SpeedRegulationScene($('#route-scene'), scenario);
  lkj.setRouteSampler((distance) => routeScene?.ready ? {
    grade: Number(simulation.scenario.operatingGrade) || 0,
    curve: routeScene.getPathCurve(distance),
  } : { grade: 0, curve: 0 });
  const loadStatus = $('#candidate-load-status');
  routeScene.loadPromise.then(() => {
    candidateRouteReady = true;
    if (loadStatus) {
      loadStatus.textContent = '线路环境已加载，可以进入考评。';
      loadStatus.dataset.state = 'ready';
    }
    updateCandidateGate();
  }).catch((error) => {
    candidateLoadFailed = true;
    if (loadStatus) {
      loadStatus.textContent = `线路环境加载失败：${error.message}`;
      loadStatus.dataset.state = 'error';
    }
    $('#status-message').textContent = `线路加载失败：${error.message}`;
    updateCandidateGate();
  });
}

function syncVisualViewport() {
  const viewport = window.visualViewport;
  document.documentElement.style.setProperty('--visual-height', `${viewport?.height || window.innerHeight}px`);
  document.documentElement.style.setProperty('--visual-offset-top', `${viewport?.offsetTop || 0}px`);
  routeScene?.resize?.();
}

function isPortraitMobile() {
  return mobileLike && matchMedia('(orientation: portrait)').matches;
}

function syncLandscapeGate() {
  const gate = $('#landscape-gate');
  if (!gate || !candidateProfile) return;
  gate.hidden = !isPortraitMobile();
}

async function enterImmersive() {
  document.documentElement.classList.add('immersive');
  $('#landscape-gate').hidden = true;
  try {
    const root = document.documentElement;
    if (!document.fullscreenElement) {
      if (root.requestFullscreen) await root.requestFullscreen({ navigationUI: 'hide' });
      else if (root.webkitRequestFullscreen) await root.webkitRequestFullscreen();
    }
  } catch { /* iPhone Safari 等浏览器可能拒绝网页全屏，保留横屏提示作为回退。 */ }
  try { await screen.orientation?.lock?.('landscape'); }
  catch { /* iOS 和部分内置浏览器不支持方向锁定。 */ }
  setTimeout(() => {
    scrollTo(0, 1);
    syncVisualViewport();
    syncLandscapeGate();
  }, 160);
}

function updateCandidateGate() {
  const name = $('#candidate-name');
  const studentId = $('#candidate-student-id');
  const submit = $('#candidate-submit');
  const error = $('#candidate-error');
  const validation = validateCandidate({ name: name?.value, studentId: studentId?.value });
  name?.setAttribute('aria-invalid', String(Boolean(name?.value) && validation.field === 'name'));
  studentId?.setAttribute('aria-invalid', String(Boolean(studentId?.value) && validation.field === 'studentId'));
  if (error) error.textContent = (name?.value || studentId?.value) && !validation.valid ? validation.message : '';
  if (submit) {
    const ready = candidateRouteReady && candidateCabReady && !candidateLoadFailed;
    submit.disabled = !ready || !validation.valid;
    submit.textContent = candidateLoadFailed ? '环境加载失败'
      : !ready ? '考评环境加载中'
        : validation.valid ? (mobileLike ? '横屏进入考评' : '进入考评') : '请填写姓名和学号';
  }
  return validation;
}

function setupCandidateGate() {
  const form = $('#candidate-form');
  const name = $('#candidate-name');
  const studentId = $('#candidate-student-id');
  const gate = $('#candidate-gate');
  const app = $('.training-app');
  const draft = loadCandidateDraft();
  name.value = draft.name;
  studentId.value = draft.studentId;
  const cab = $('#cab-view');
  const cabReady = typeof cab.decode === 'function'
    ? cab.decode()
    : new Promise((resolve, reject) => {
      if (cab.complete && cab.naturalWidth) resolve();
      else {
        cab.addEventListener('load', resolve, { once: true });
        cab.addEventListener('error', reject, { once: true });
      }
    });
  cabReady.then(() => { candidateCabReady = true; updateCandidateGate(); }).catch(() => {
    candidateLoadFailed = true;
    const loadStatus = $('#candidate-load-status');
    loadStatus.textContent = '驾驶台图片加载失败，请刷新页面重试。';
    loadStatus.dataset.state = 'error';
    updateCandidateGate();
  });
  for (const input of [name, studentId]) {
    input.addEventListener('input', updateCandidateGate);
    input.addEventListener('focus', syncVisualViewport);
  }
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!candidateRouteReady || !candidateCabReady || candidateLoadFailed) return;
    const validation = updateCandidateGate();
    if (!validation.valid) {
      (validation.field === 'name' ? name : studentId).focus();
      return;
    }
    candidateProfile = saveCandidateDraft(validation.candidate);
    gate.hidden = true;
    document.body.classList.remove('candidate-entry-active');
    app.inert = false;
    syncVisualViewport();
    if (mobileLike) await enterImmersive();
    else routeScene?.resize?.();
  });
  window.visualViewport?.addEventListener('resize', syncVisualViewport);
  window.visualViewport?.addEventListener('scroll', syncVisualViewport);
  syncVisualViewport();
  updateCandidateGate();
}

function makeSprite(id, image, x, y, width, height, columns, rows, label) {
  const element = document.createElement('div');
  element.className = `sprite ${id}`;
  element.setAttribute('aria-label', label);
  Object.assign(element.style, { left: pct(x, CAB.width), top: pct(y, CAB.height), width: pct(width, CAB.width), height: pct(height, CAB.height), backgroundImage: `url("./assets/archive-cabview/${image}")`, backgroundSize: `${columns * 100}% ${rows * 100}%` });
  overlay.append(element);
  return element;
}

function makeBadge(id, label, x, y, width = 82) {
  const element = document.createElement('button');
  element.type = 'button';
  element.className = 'control-position-badge';
  element.innerHTML = `<b>${label}</b><span>—</span>`;
  Object.assign(element.style, { left: pct(x, CAB.width), top: pct(y, CAB.height), width: pct(width, CAB.width) });
  overlay.append(element);
  return element;
}

function makePhysical(label, x, y, width, height, handler, className = '') {
  const element = document.createElement('button');
  element.type = 'button';
  element.className = `physical-control ${className}`;
  element.setAttribute('aria-label', label);
  Object.assign(element.style, { left: pct(x, CAB.width), top: pct(y, CAB.height), width: pct(width, CAB.width), height: pct(height, CAB.height) });
  element.addEventListener('click', handler);
  overlay.append(element);
  return element;
}

function makeNeedle(image, x, y, width, height, pivot, start, end) {
  const needle = document.createElement('img');
  needle.className = 'cab-needle';
  needle.src = `./assets/archive-cabview/${image}`;
  needle.alt = '';
  needle.setAttribute('aria-hidden', 'true');
  needle.dataset.start = start;
  needle.dataset.end = end;
  Object.assign(needle.style, { left: pct(x, CAB.width), top: pct(y, CAB.height), width: pct(width, CAB.width), height: pct(height, CAB.height), transformOrigin: `50% ${pivot / height * 100}%` });
  overlay.append(needle);
  return needle;
}

function setNeedle(needle, value, maximum) {
  const ratio = clamp(Number(value || 0) / maximum, 0, 1);
  needle.style.transform = `rotate(${Number(needle.dataset.start) + (Number(needle.dataset.end) - Number(needle.dataset.start)) * ratio}deg)`;
}

function makeBar(x, y, width, height, color) {
  const bar = document.createElement('div');
  bar.className = 'cab-gauge-bar';
  Object.assign(bar.style, { left: pct(x, CAB.width), top: pct(y, CAB.height), width: pct(width, CAB.width), height: pct(height, CAB.height), backgroundColor: color });
  overlay.append(bar);
  return bar;
}

function makeDigital(x, y, width, height, className = '') {
  const digital = document.createElement('div');
  digital.className = `cab-digital ${className}`;
  Object.assign(digital.style, { left: pct(x, CAB.width), top: pct(y, CAB.height), width: pct(width, CAB.width), height: pct(height, CAB.height) });
  overlay.append(digital);
  return digital;
}

function frame(element, index, columns, rows) {
  const column = index % columns;
  const row = Math.floor(index / columns);
  element.style.backgroundPosition = `${columns === 1 ? 0 : column / (columns - 1) * 100}% ${rows === 1 ? 0 : row / (rows - 1) * 100}%`;
}

function tractionFrame(value) {
  // 驾驶台贴图仅有7个正牵引姿态，12个速度给定级位按全行程映射到原手柄姿态。
  return value > 0 ? Math.max(0, 7 - Math.round(Math.min(TRACTION_MAX, value) / TRACTION_MAX * 7)) : value === 0 ? 7 : Math.min(15, 7 + Math.min(8, Math.abs(value)));
}

function createCabControls() {
  overlay.replaceChildren();
  elements.auto = makeSprite('auto-brake', 'HXD1C_DZ.png', 35, 341, 45, 60, 4, 3, '自动制动阀');
  elements.independent = makeSprite('independent-brake', 'HXD1C_XZ.png', 138, 341, 35, 60, 4, 3, '单独制动阀');
  elements.traction = makeSprite('traction', 'HXD1C_GL.png', 464, 345, 46, 81, 2, 8, '牵引和电制动手柄');
  elements.direction = makeSprite('direction', 'HXD1C_HX.png', 530, 366, 60, 40, 3, 1, '换向手柄');
  elements.autoBadge = makeBadge('auto', '自阀', 20, 321, 80);
  elements.independentBadge = makeBadge('independent', '单阀', 116, 321, 78);
  elements.tractionBadge = makeBadge('traction', '牵引手柄', 438, 323, 86);
  elements.directionBadge = makeBadge('direction', '换向手柄', 521, 342, 88);
  elements.sideRelease = makeBadge('side-release', '单缓', 113, 404, 68);
  elements.sideRelease.classList.add('side-release-control');
  elements.sideRelease.addEventListener('click', () => simulation.command('side-release', !simulation.state.sideRelease));
  makePhysical('放大LKJ监控装置', 210, 226, 101, 94, () => lkj.show(), 'lkj-hotspot');
  elements.speedDigital = makeDigital(229, 251, 20, 7, 'speed');
  elements.limitDigital = makeDigital(244, 251, 20, 7, 'limit');
  elements.clockDigital = makeDigital(230, 268, 45, 10, 'clock');
  elements.speedNeedle = makeNeedle('HXD1C_SDZ.png', 493, 277, 3, 18, 2, 68, 300);
  elements.mainNeedle = makeNeedle('HXD1C_red.png', 154, 253, 7, 21, 14, 230, 100);
  elements.pipeNeedle = makeNeedle('HXD1C_black.png', 154, 253, 7, 21, 14, 230, 130);
  elements.eqNeedle = makeNeedle('HXD1C_black.png', 162, 295, 7, 21, 14, 224, 136);
  elements.cylNeedle = makeNeedle('HXD1C_red.png', 162, 295, 7, 21, 14, 230, 130);
  elements.mainNeedle2 = makeNeedle('HXD1C_PPW.png', 75, 299, 7, 18, 1, 3, 358);
  elements.pipeNeedle2 = makeNeedle('HXD1C_PPR.png', 75, 299, 7, 18, 1, 3, 336);
  elements.eqNeedle2 = makeNeedle('HXD1C_PPW.png', 36, 312, 7, 18, 1, 3, 336);
  elements.cylNeedle2 = makeNeedle('HXD1C_PPR.png', 36, 312, 7, 18, 1, 3, 300);
  elements.voltageBar = makeBar(351, 266, 4, 30, '#56e9aa');
  elements.currentBars = [362, 370, 381, 388].map((x) => makeBar(x, 266, 4, 30, '#66e9e8'));
  elements.signal = makeSprite('locomotive-signal', 'HXD1C_jx.png', 540, 0, 100, 162, 4, 2, '机车信号');
  elements.pantograph = makeSprite('pantograph-state', 'HXD1C_DG.png', 410, 295, 7, 8, 1, 2, '受电弓状态');
  makePhysical('警惕复位', 386, 312, 32, 32, () => simulation.command('lkj-ack'), 'reset-hotspot');
  makePhysical('查看机车信号', 540, 0, 100, 162, () => lkj.show(), 'signal-hotspot');
  makePhysical('打开CIR机车综合无线通信设备', 606, 276, 34, 118, () => { lkj.close(); cir.open(); }, 'cir-hotspot');
  elements.horn = makePhysical('按住鸣笛', 577, 408, 37, 39, () => {}, 'horn-hotspot');
  elements.horn.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    hornPointerId = event.pointerId;
    elements.horn.classList.add('pressed');
    simulation.command('horn-start');
    hornAudio.currentTime = 0;
    hornAudio.play().catch(() => {});
    try { elements.horn.setPointerCapture(event.pointerId); } catch { /* 窗口级释放监听仍然有效。 */ }
  });

  const controls = [
    ['auto', elements.auto, 0, 5, 13],
    ['independent', elements.independent, 0, 5, 13],
    ['traction', elements.traction, -8, TRACTION_MAX, 12],
  ];
  for (const [id, sprite, min, max, step] of controls) {
    const begin = (event) => {
      event.preventDefault();
      const stateKey = id === 'auto' ? 'autoBrake' : id === 'independent' ? 'independentBrake' : 'traction';
      const scale = $('#stage').getBoundingClientRect().height / CAB.height;
      activeDrag = { id, stateKey, pointerId: event.pointerId, startY: event.clientY, startValue: simulation.state[stateKey], min, max, step: Math.max(4, step * scale), moved: false };
      event.currentTarget.setPointerCapture?.(event.pointerId);
    };
    sprite.addEventListener('pointerdown', begin);
    const badge = id === 'auto' ? elements.autoBadge : id === 'independent' ? elements.independentBadge : elements.tractionBadge;
    badge.addEventListener('pointerdown', begin);
    badge.addEventListener('click', () => {
      if (activeDrag) return;
      if (lastDragged.id === id && performance.now() - lastDragged.at < 350) return;
      const key = id === 'auto' ? 'autoBrake' : id === 'independent' ? 'independentBrake' : 'traction';
      const next = simulation.state[key] >= max ? (id === 'traction' ? 0 : min) : simulation.state[key] + 1;
      simulation.command(id === 'auto' ? 'auto-brake' : id === 'independent' ? 'independent-brake' : 'traction', next);
    });
  }
  elements.direction.addEventListener('click', () => setDirection());
  elements.directionBadge.addEventListener('click', () => setDirection());
}

function setDirection() {
  const next = simulation.state.direction === 'F' ? 'N' : 'F';
  simulation.command('direction', next);
}

window.addEventListener('pointermove', (event) => {
  if (!activeDrag || event.pointerId !== activeDrag.pointerId) return;
  const change = Math.round((activeDrag.startY - event.clientY) / activeDrag.step);
  if (change) activeDrag.moved = true;
  const value = clamp(activeDrag.startValue + change, activeDrag.min, activeDrag.max);
  simulation.command(activeDrag.id === 'auto' ? 'auto-brake' : activeDrag.id === 'independent' ? 'independent-brake' : 'traction', value);
});
window.addEventListener('pointerup', (event) => { if (activeDrag?.pointerId === event.pointerId) { if (activeDrag.moved) lastDragged = { id: activeDrag.id, at: performance.now() }; activeDrag = null; } });
window.addEventListener('pointercancel', () => { activeDrag = null; });

function chooseScenario(id) {
  if (!candidateProfile) {
    $('#candidate-gate').hidden = false;
    document.body.classList.add('candidate-entry-active');
    $('.training-app').inert = true;
    $('#candidate-name').focus();
    return;
  }
  const scenario = getScenario(id);
  candidateAttempt = createCandidateAttempt(candidateProfile);
  simulation = new SpeedRegulationSimulation(scenario.id);
  assessment = new SpeedRegulationAssessment(simulation);
  lkj.simulation = simulation;
  lkj.setCandidate(candidateAttempt);
  lkj.profileCache = null;
  cir.setSimulation(simulation);
  lkj.page = 'main';
  lkj.menuIndex = 0;
  if (routeScene) routeScene.setScenario(scenario);
  else preloadRouteScene();
  simulation.addEventListener('change', () => render());
  simulation.addEventListener('complete', () => showResult());
  localStorage.setItem(`${PROJECT_ID}:last-scenario`, scenario.id);
  resultShown = false;
  $('#skill-name').textContent = scenario.title;
  $('#skill-picker').classList.remove('open');
  $('#result-modal').classList.remove('open');
  lkj.close();
  cir.close();
  $('#mobile-operations').classList.remove('open');
  $('#mobile-operations').setAttribute('aria-hidden', 'true');
  $('#mobile-operations-toggle').setAttribute('aria-expanded', 'false');
  selectedView = 'front';
  selectView('front');
  simulation.start();
  lastFrame = performance.now();
  render();
}

function selectView(view) {
  selectedView = view;
  $('#cab-view').src = `./assets/archive-cabview/${views[view]}`;
  overlay.classList.toggle('hidden', view !== 'front');
  if (view !== 'front') cir.close();
  document.querySelectorAll('[data-view]').forEach((button) => button.classList.toggle('active', button.dataset.view === view));
  routeScene?.setView(view);
}

function render() {
  const s = simulation.state;
  const scenario = simulation.scenario;
  frame(elements.auto, [0, 1, 2, 9, 10, 11][s.autoBrake], 4, 3);
  frame(elements.independent, s.independentBrake, 4, 3);
  frame(elements.traction, tractionFrame(s.traction), 2, 8);
  frame(elements.direction, s.direction === 'R' ? 0 : s.direction === 'N' ? 1 : 2, 3, 1);
  elements.autoBadge.querySelector('span').textContent = brakeNames[s.autoBrake];
  elements.independentBadge.querySelector('span').textContent = s.independentBrake ? `${s.independentBrake}级` : '缓解位';
  elements.tractionBadge.querySelector('span').textContent = s.traction > 0 ? `牵引 ${s.traction}级 / ${s.tractionTargetSpeed} km/h` : s.traction < 0 ? `电制 ${Math.abs(s.traction)}级` : '零位';
  $('[data-mobile-traction]').textContent = elements.tractionBadge.querySelector('span').textContent;
  $('[data-mobile-auto]').textContent = brakeNames[s.autoBrake];
  $('[data-mobile-independent]').textContent = s.independentBrake ? `${s.independentBrake}级` : '缓解位';
  elements.directionBadge.querySelector('span').textContent = s.direction === 'F' ? '前进位' : s.direction === 'R' ? '后退位' : '中立位';
  elements.sideRelease.classList.toggle('active', s.sideRelease);
  elements.sideRelease.querySelector('span').textContent = s.sideRelease ? '已单缓' : '未动作';
  $('#shock-stick').dataset.level = String(Math.min(6, Math.max(s.shockStickFallen, Math.ceil(s.shockStickTilt / 15))));
  $('#shock-stick').classList.toggle('fallen', s.shockStickTilt >= 70);
  setNeedle(elements.speedNeedle, s.speed, 158);
  setNeedle(elements.mainNeedle, s.mainReservoir, 1600);
  setNeedle(elements.pipeNeedle, s.trainPipe, 1000);
  setNeedle(elements.eqNeedle, s.equalizingReservoir, 1600);
  setNeedle(elements.cylNeedle, s.brakeCylinder, 1600);
  setNeedle(elements.mainNeedle2, s.mainReservoir, 1600);
  setNeedle(elements.pipeNeedle2, s.trainPipe, 1600);
  setNeedle(elements.eqNeedle2, s.equalizingReservoir, 1600);
  setNeedle(elements.cylNeedle2, s.brakeCylinder, 1600);
  elements.voltageBar.style.transform = `scaleY(${clamp(s.netVoltage / 3800, .02, 1)})`;
  elements.currentBars.forEach((bar, index) => { bar.style.transform = `scaleY(${clamp((s.tractionCurrent - index * 18) / (index < 2 ? 1000 : 800), .02, 1)})`; });
  elements.speedDigital.textContent = s.speed < 10 ? s.speed.toFixed(1) : s.speed.toFixed(0);
  elements.limitDigital.textContent = s.lkjLimit.toFixed(0);
  elements.clockDigital.textContent = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  frame(elements.signal, { green: 7, 'green-yellow': 6, yellow: 5, 'double-yellow': 4, red: 0 }[s.signal.aspect] ?? 0, 4, 2);
  frame(elements.pantograph, 1, 1, 2);
  $('#phase-name').textContent = s.phase?.label || '考评区段';
  const levelText = { normal: '监控正常', warning: 'LKJ报警', unload: 'LKJ卸载', service: 'LKJ常用制动', emergency: 'LKJ紧急制动' }[s.lkjLevel];
  const nextSignalDistance = Math.max(0, (s.signal.distance || s.distance) - s.distance);
  const nextSignalText = s.signal.id === 'clear' ? '已通过进站信号机' : `距${s.signal.label} ${nextSignalDistance.toFixed(0)} m`;
  $('#status-message').textContent = `${levelText} · ${nextSignalText}`;
  const progress = assessment.progress(s);
  $('#progress-count').textContent = `${progress.done}/${progress.total}`;
  renderProgress(progress);
  renderData(s);
  if (cir.root.classList.contains('open')) cir.render();
  if (lkj.open) lkj.render();
  if (s.lkjLevel !== lastAlertLevel && s.lkjLevel !== 'normal') alertTone(s.lkjLevel);
  lastAlertLevel = s.lkjLevel;
}

function renderProgress(progress) {
  const names = simulation.scenario.id === 'twoStage'
    ? ['LKJ查看记录', `三架信号呼唤 ${progress.calloutDone}/${progress.calloutTotal}`, '首次制动保持11级', '首次制动前后侧缓≥1秒', '首次制动记录', '稳定后退至9级', '阶段缓解记录', '列车管充风记录', '第二次制动保持9级并前后侧缓≥1秒', '第二次制动记录', '稳定后退至4级', '进站速度记录', '站内续行完成']
    : ['LKJ查看记录', `三架信号呼唤 ${progress.calloutDone}/${progress.calloutTotal}`, '制动时保持11级', '制动前后侧缓≥1秒', '制动操作记录', '稳定后退至4级', '进站速度记录', '站内续行完成'];
  $('#progress-list').innerHTML = names.map((name, index) => `<li class="${progress.checks[index] ? 'done' : index === progress.current ? 'active' : 'pending'}"><b>${String(index + 1).padStart(2, '0')}</b><span>${name}</span><em>${progress.checks[index] ? '已记录' : index === progress.current ? '待记录' : '未到达'}</em></li>`).join('');
}

function renderData(s) {
  const grade = Number(simulation.scenario.operatingGrade) || 0;
  const rows = [
    ['速度', `${s.speed.toFixed(1)} km/h`], ['加速度', `${s.acceleration.toFixed(3)} m/s²`], ['LKJ限速', `${s.lkjLimit.toFixed(0)} km/h`], ['运行距离', `${s.distance.toFixed(0)} m`], ['距进站信号', `${Math.max(0, simulation.scenario.entryDistance - s.distance).toFixed(0)} m`], ['下一信号', s.signal.label], ['距下一信号', `${Math.max(0, (s.signal.distance || s.distance) - s.distance).toFixed(0)} m`],
    ['总风缸', `${s.mainReservoir.toFixed(0)} kPa`], ['列车管', `${s.trainPipe.toFixed(0)} kPa`], ['列尾风压', `${s.tailPipe.toFixed(0)} kPa`], ['制动缸', `${s.brakeCylinder.toFixed(0)} kPa`], ['网压', `${(s.netVoltage / 100).toFixed(1)} kV`], ['牵引电流', `${s.tractionCurrent.toFixed(0)} A`], ['牵引力', `${(s.tractionForce / 1000).toFixed(0)} kN`], ['电制动力', `${(s.electricBrakeForce / 1000).toFixed(0)} kN`], ['冲动指数', `${s.shockIndex.toFixed(0)}（最大 ${s.maxShockIndex.toFixed(0)}）`], ['考评坡度', `${grade >= 0 ? '+' : ''}${grade.toFixed(1)} ‰（平道）`], ['牵引手柄', s.traction > 0 ? `${s.traction} 级 / 给定 ${s.tractionTargetSpeed} km/h` : `${s.traction} 级`], ['估算平衡速度', `${s.balanceSpeed.toFixed(0)} km/h`], ['自阀', brakeNames[s.autoBrake]],
  ];
  $('#run-data').innerHTML = rows.map(([key, value]) => `<div><dt>${key}</dt><dd>${value}</dd></div>`).join('');
}

function showResult() {
  if (resultShown) return;
  resultShown = true;
  const result = assessment.result();
  $('#result-name').textContent = candidateAttempt?.name || '—';
  $('#result-student-id').textContent = candidateAttempt?.studentId || '—';
  $('#result-started-at').textContent = formatAttemptTime(candidateAttempt?.startedAt);
  $('#result-finished-at').textContent = formatAttemptTime(new Date());
  $('#result-score').textContent = result.score;
  $('#result-grade').textContent = result.summary;
  $('.result-score').classList.toggle('fail', !result.qualified);
  $('#result-title').textContent = simulation.scenario.title;
  $('#result-summary').textContent = `进站信号机通过速度 ${result.entrySpeed?.toFixed(1) ?? '—'} km/h，最大冲动指数 ${result.maxShock.toFixed(0)}，运行 ${result.distance.toFixed(0)} m，用时 ${result.duration.toFixed(0)} s。${result.redline ? '本次触发安全红线。' : ''}`;
  $('#result-categories').innerHTML = result.categories.map((category) => `<div><span>${category.name}<small>${category.notes.length ? category.notes.join('；') : '符合要求'}</small></span><b>${category.score}/${category.maximum}</b></div>`).join('');
  renderResultTrace();
  $('#result-modal').classList.add('open');
  $('#result-modal').setAttribute('aria-hidden', 'false');
}

function renderResultTrace() {
  const container = $('#result-trace');
  if (!container) return;
  const scenario = simulation.scenario;
  const state = simulation.state;
  const width = 900;
  const height = 220;
  const left = 42;
  const right = 884;
  const top = 22;
  const bottom = 184;
  const routeLength = Math.max(1, scenario.finishDistance);
  const xAt = (distance) => left + clamp(Number(distance) || 0, 0, routeLength) / routeLength * (right - left);
  const yAt = (speed) => bottom - clamp(Number(speed) || 0, 0, 120) / 120 * (bottom - top);
  const actual = state.samples.map((sample) => `${xAt(sample.distance).toFixed(1)},${yAt(sample.speed).toFixed(1)}`).join(' ');
  const control = [];
  for (let distance = 0; distance <= routeLength; distance += Math.max(20, routeLength / 140)) {
    control.push(`${xAt(distance).toFixed(1)},${yAt(lkjControlLimit(scenario, distance)).toFixed(1)}`);
  }
  const applications = state.events.filter((event) => event.type === 'auto-brake' && event.value > 0 && event.previous?.autoBrake === 0);
  const releases = state.events.filter((event) => event.type === 'auto-brake' && event.value === 0 && event.previous?.autoBrake > 0);
  const markers = [
    ...applications.map((event, index) => ({ ...event, label: scenario.id === 'twoStage' ? `第${index + 1}次制动` : '制动开始', className: 'brake' })),
    ...releases.map((event) => ({ ...event, label: '缓解充风', className: 'release' })),
  ].map((event) => {
    const x = xAt(event.distance);
    const y = yAt(event.speed);
    return `<g class="result-marker ${event.className}"><line x1="${x}" y1="${y}" x2="${x}" y2="${bottom}"/><circle cx="${x}" cy="${y}" r="5"/><text x="${Math.min(right - 66, x + 6)}" y="${Math.max(top + 10, y - 7)}">${event.label}</text></g>`;
  }).join('');
  container.innerHTML = `<div class="result-trace-head"><b>LKJ运行轨迹复盘</b><span><i class="actual"></i>实际速度</span><span><i class="control"></i>控制曲线</span></div><svg viewBox="0 0 ${width} ${height}" role="img" aria-label="LKJ实际速度与控制曲线复盘">
    <g class="result-grid"><line x1="${left}" y1="${yAt(120)}" x2="${right}" y2="${yAt(120)}"/><line x1="${left}" y1="${yAt(80)}" x2="${right}" y2="${yAt(80)}"/><line x1="${left}" y1="${yAt(40)}" x2="${right}" y2="${yAt(40)}"/><line x1="${left}" y1="${bottom}" x2="${right}" y2="${bottom}"/></g>
    <text x="4" y="${yAt(120) + 4}">120</text><text x="12" y="${yAt(80) + 4}">80</text><text x="12" y="${yAt(40) + 4}">40</text>
    <polyline class="result-control-line" points="${control.join(' ')}"/><polyline class="result-actual-line" points="${actual}"/>${markers}
    <text x="${left}" y="207">0 km</text><text x="${right - 45}" y="207">${(routeLength / 1000).toFixed(1)} km</text></svg>`;
}

function alertTone(level) {
  try {
    audioContext ||= new AudioContext();
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    oscillator.frequency.value = level === 'emergency' ? 880 : level === 'service' ? 720 : 560;
    gain.gain.setValueAtTime(.05, audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(.001, audioContext.currentTime + .22);
    oscillator.connect(gain).connect(audioContext.destination);
    oscillator.start(); oscillator.stop(audioContext.currentTime + .23);
  } catch { /* 浏览器可能在首次手势前禁止音频。 */ }
}

function togglePanel(panel) {
  document.querySelectorAll('.side-panel').forEach((item) => {
    const open = item === panel && !item.classList.contains('open');
    item.classList.toggle('open', open);
    item.setAttribute('aria-hidden', String(!open));
  });
}

function animationFrame(now) {
  const dt = Math.min(.08, (now - lastFrame) / 1000);
  lastFrame = now;
  simulation.state.grade = Number(simulation.scenario.operatingGrade) || 0;
  simulation.tick(dt);
  if (routeScene) {
    routeScene.update(simulation.state.distance, simulation.state.speed, selectedView);
    routeScene.render();
  }
  requestAnimationFrame(animationFrame);
}

createCabControls();
document.querySelectorAll('[data-scenario]').forEach((button) => button.addEventListener('click', () => chooseScenario(button.dataset.scenario)));
$('#callout').addEventListener('click', () => simulation.command('callout'));
$('#progress-toggle').addEventListener('click', () => togglePanel($('#progress-panel')));
$('#rules-toggle').addEventListener('click', () => togglePanel($('#rules-panel')));
$('#data-toggle').addEventListener('click', () => togglePanel($('#data-panel')));
$('#shock-stick').addEventListener('click', () => simulation.command('shock-reset'));
$('#mobile-operations-toggle').addEventListener('click', () => {
  const open = !$('#mobile-operations').classList.contains('open');
  $('#mobile-operations').classList.toggle('open', open);
  $('#mobile-operations').setAttribute('aria-hidden', String(!open));
  $('#mobile-operations-toggle').setAttribute('aria-expanded', String(open));
});
$('[data-mobile-close]').addEventListener('click', () => $('#mobile-operations-toggle').click());
document.querySelectorAll('[data-mobile-command]').forEach((button) => button.addEventListener('click', () => {
  const action = button.dataset.mobileCommand;
  const s = simulation.state;
  if (action === 'traction-down') simulation.command('traction', Math.max(-8, s.traction - 1));
  else if (action === 'traction-zero') simulation.command('traction', 0);
  else if (action === 'traction-up') simulation.command('traction', Math.min(TRACTION_MAX, s.traction + 1));
  else if (action === 'auto-down') simulation.command('auto-brake', Math.max(0, s.autoBrake - 1));
  else if (action === 'auto-up') simulation.command('auto-brake', Math.min(5, s.autoBrake + 1));
  else if (action === 'independent-down') simulation.command('independent-brake', Math.max(0, s.independentBrake - 1));
  else if (action === 'independent-up') simulation.command('independent-brake', Math.min(5, s.independentBrake + 1));
  else if (action === 'side-release') simulation.command('side-release', !s.sideRelease);
  else if (action === 'lkj') { $('#mobile-operations-toggle').click(); cir.close(); lkj.show(); }
  else if (action === 'cir') { $('#mobile-operations-toggle').click(); lkj.close(); cir.open(); }
}));
$('#view-toggle').addEventListener('click', () => $('#view-menu').classList.toggle('open'));
document.querySelectorAll('[data-view]').forEach((button) => button.addEventListener('click', () => { selectView(button.dataset.view); $('#view-menu').classList.remove('open'); }));
document.querySelectorAll('[data-close-panel]').forEach((button) => button.addEventListener('click', () => togglePanel(button.closest('.side-panel'))));
$('#fullscreen').addEventListener('click', async () => {
  if (document.fullscreenElement) await document.exitFullscreen();
  else if (mobileLike) await enterImmersive();
  else await $('#stage').requestFullscreen();
});
$('#enter-landscape').addEventListener('click', enterImmersive);
$('#retry').addEventListener('click', () => chooseScenario(simulation.state.scenarioId));
$('#choose-skill').addEventListener('click', () => { $('#result-modal').classList.remove('open'); $('#skill-picker').classList.add('open'); });
$('#change-candidate').addEventListener('click', () => { clearCandidateDraft(); location.reload(); });
window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') { document.querySelectorAll('.side-panel').forEach((panel) => panel.classList.remove('open')); $('#view-menu').classList.remove('open'); cir.close(); lkj.close(); }
});
window.addEventListener('orientationchange', () => {
  syncVisualViewport();
  setTimeout(() => { syncVisualViewport(); syncLandscapeGate(); }, 180);
});
window.addEventListener('fullscreenchange', () => {
  syncVisualViewport();
  if (!document.fullscreenElement && !isPortraitMobile()) document.documentElement.classList.remove('immersive');
  syncLandscapeGate();
});
function stopHorn(event) {
  if (hornPointerId === null || (event?.pointerId != null && event.pointerId !== hornPointerId)) return;
  hornPointerId = null;
  hornAudio.pause();
  hornAudio.currentTime = 0;
  elements.horn?.classList.remove('pressed');
  simulation.command('horn-stop');
}
window.addEventListener('pointerup', stopHorn);
window.addEventListener('pointercancel', stopHorn);

window.__speedRegulation = { get simulation() { return simulation; }, get assessment() { return assessment; }, chooseScenario };
preloadRouteScene();
setupCandidateGate();
render();
requestAnimationFrame(animationFrame);
