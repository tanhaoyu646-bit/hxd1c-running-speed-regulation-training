import { CAB, PROJECT_ID, getScenario } from './speedRegulationConfig.js';
import { SpeedRegulationSimulation } from './speedRegulationSimulation.js';
import { SpeedRegulationAssessment } from './speedRegulationAssessment.js';
import { SpeedRegulationScene } from './speedRegulationScene.js';
import { LkjRuntime } from './lkjRuntime.js';

const $ = (selector) => document.querySelector(selector);
const pct = (value, total) => `${value / total * 100}%`;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const views = { front: 'HXD1C_front.png', left: 'HXD1C_left_full.png', right: 'HXD1C_right_full.png', rearLeft: 'HXD1C_left.png', rearRight: 'HXD1C_right.png' };
const brakeNames = ['运转位', '初制位', '常用Ⅱ', '常用Ⅲ', '常用Ⅳ', '紧急位'];

let simulation = new SpeedRegulationSimulation('oneStage');
let assessment = new SpeedRegulationAssessment(simulation);
let routeScene = null;
let lkj = new LkjRuntime($('#lkj-dock'), simulation);
let selectedView = 'front';
let lastFrame = performance.now();
let resultShown = false;
let activeDrag = null;
let audioContext = null;
let lastAlertLevel = 'normal';
const overlay = $('#cab-overlay');
const elements = {};

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

function frame(element, index, columns, rows) {
  const column = index % columns;
  const row = Math.floor(index / columns);
  element.style.backgroundPosition = `${columns === 1 ? 0 : column / (columns - 1) * 100}% ${rows === 1 ? 0 : row / (rows - 1) * 100}%`;
}

function tractionFrame(value) { return value > 0 ? Math.max(0, 7 - Math.min(7, value)) : value === 0 ? 7 : Math.min(15, 7 + Math.min(8, Math.abs(value))); }

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

  const controls = [
    ['auto', elements.auto, 0, 5, 13],
    ['independent', elements.independent, 0, 5, 13],
    ['traction', elements.traction, -8, 7, 19],
  ];
  for (const [id, sprite, min, max, step] of controls) {
    const begin = (event) => {
      event.preventDefault();
      const stateKey = id === 'auto' ? 'autoBrake' : id === 'independent' ? 'independentBrake' : 'traction';
      activeDrag = { id, stateKey, pointerId: event.pointerId, startY: event.clientY, startValue: simulation.state[stateKey], min, max, step };
      event.currentTarget.setPointerCapture?.(event.pointerId);
    };
    sprite.addEventListener('pointerdown', begin);
    const badge = id === 'auto' ? elements.autoBadge : id === 'independent' ? elements.independentBadge : elements.tractionBadge;
    badge.addEventListener('pointerdown', begin);
    badge.addEventListener('click', () => {
      if (activeDrag) return;
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
  const value = clamp(activeDrag.startValue + change, activeDrag.min, activeDrag.max);
  simulation.command(activeDrag.id === 'auto' ? 'auto-brake' : activeDrag.id === 'independent' ? 'independent-brake' : 'traction', value);
});
window.addEventListener('pointerup', (event) => { if (activeDrag?.pointerId === event.pointerId) activeDrag = null; });
window.addEventListener('pointercancel', () => { activeDrag = null; });

function chooseScenario(id) {
  const scenario = getScenario(id);
  simulation = new SpeedRegulationSimulation(scenario.id);
  assessment = new SpeedRegulationAssessment(simulation);
  lkj.simulation = simulation;
  lkj.page = 'main';
  lkj.menuIndex = 0;
  routeScene?.resizeObserver?.disconnect();
  routeScene?.renderer?.dispose();
  const oldCanvas = $('#route-scene');
  const newCanvas = oldCanvas.cloneNode(false);
  oldCanvas.replaceWith(newCanvas);
  routeScene = new SpeedRegulationScene(newCanvas, scenario);
  routeScene.loadPromise.catch((error) => { $('#status-message').textContent = `线路加载失败：${error.message}`; });
  simulation.addEventListener('change', () => render());
  simulation.addEventListener('complete', () => showResult());
  localStorage.setItem(`${PROJECT_ID}:last-scenario`, scenario.id);
  resultShown = false;
  $('#skill-name').textContent = scenario.title;
  $('#skill-picker').classList.remove('open');
  $('#result-modal').classList.remove('open');
  $('#lkj-dock').classList.remove('open');
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
  document.querySelectorAll('[data-view]').forEach((button) => button.classList.toggle('active', button.dataset.view === view));
  routeScene?.setView(view);
}

function render() {
  const s = simulation.state;
  const scenario = simulation.scenario;
  frame(elements.auto, s.autoBrake, 4, 3);
  frame(elements.independent, s.independentBrake, 4, 3);
  frame(elements.traction, tractionFrame(s.traction), 2, 8);
  frame(elements.direction, s.direction === 'R' ? 0 : s.direction === 'N' ? 1 : 2, 3, 1);
  elements.autoBadge.querySelector('span').textContent = brakeNames[s.autoBrake];
  elements.independentBadge.querySelector('span').textContent = s.independentBrake ? `${s.independentBrake}级` : '缓解位';
  elements.tractionBadge.querySelector('span').textContent = s.traction > 0 ? `牵引 ${s.traction}.0级` : s.traction < 0 ? `电制 ${Math.abs(s.traction)}级` : '零位';
  elements.directionBadge.querySelector('span').textContent = s.direction === 'F' ? '前进位' : s.direction === 'R' ? '后退位' : '中立位';
  elements.sideRelease.classList.toggle('active', s.sideRelease);
  elements.sideRelease.querySelector('span').textContent = s.sideRelease ? '已单缓' : '未动作';
  $('#phase-name').textContent = s.phase?.label || '考评区段';
  const levelText = { normal: '监控正常', warning: 'LKJ报警', unload: 'LKJ卸载', service: 'LKJ常用制动', emergency: 'LKJ紧急制动' }[s.lkjLevel];
  $('#status-message').textContent = `${levelText} · 距进站信号 ${Math.max(0, scenario.entryDistance - s.distance).toFixed(0)} m`;
  const progress = assessment.progress(s);
  $('#progress-count').textContent = `${progress.done}/${progress.total}`;
  renderProgress(progress);
  renderData(s);
  if (lkj.open) lkj.render();
  if (s.lkjLevel !== lastAlertLevel && s.lkjLevel !== 'normal') alertTone(s.lkjLevel);
  lastAlertLevel = s.lkjLevel;
}

function renderProgress(progress) {
  const names = simulation.scenario.id === 'twoStage'
    ? ['LKJ查看记录', '信号呼唤记录', '牵引回零记录', '单缓操作记录', '首次制动记录', '阶段缓解记录', '列车管充风记录', '第二次制动记录', '进站速度记录', '考评完成']
    : ['LKJ查看记录', '信号呼唤记录', '牵引回零记录', '单缓操作记录', '制动操作记录', '进站速度记录', '考评完成'];
  $('#progress-list').innerHTML = names.map((name, index) => `<li class="${progress.checks[index] ? 'done' : 'pending'}">${name}</li>`).join('');
}

function renderData(s) {
  const rows = [
    ['速度', `${s.speed.toFixed(1)} km/h`], ['LKJ限速', `${s.lkjLimit.toFixed(0)} km/h`], ['运行距离', `${s.distance.toFixed(0)} m`], ['目标距离', `${Math.max(0, simulation.scenario.entryDistance - s.distance).toFixed(0)} m`],
    ['列车管', `${s.trainPipe.toFixed(0)} kPa`], ['制动缸', `${s.brakeCylinder.toFixed(0)} kPa`], ['牵引手柄', `${s.traction} 级`], ['自阀', brakeNames[s.autoBrake]],
  ];
  $('#run-data').innerHTML = rows.map(([key, value]) => `<div><dt>${key}</dt><dd>${value}</dd></div>`).join('');
}

function showResult() {
  if (resultShown) return;
  resultShown = true;
  const result = assessment.result();
  $('#result-score').textContent = result.score;
  $('#result-grade').textContent = result.summary;
  $('.result-score').classList.toggle('fail', !result.qualified);
  $('#result-title').textContent = simulation.scenario.title;
  $('#result-summary').textContent = `进站信号机通过速度 ${result.entrySpeed?.toFixed(1) ?? '—'} km/h，运行 ${result.distance.toFixed(0)} m，用时 ${result.duration.toFixed(0)} s。${result.redline ? '本次触发安全红线。' : ''}`;
  $('#result-categories').innerHTML = result.categories.map((category) => `<div><span>${category.name}</span><b>${category.score}/${category.maximum}</b></div>`).join('');
  $('#result-modal').classList.add('open');
  $('#result-modal').setAttribute('aria-hidden', 'false');
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
$('#view-toggle').addEventListener('click', () => $('#view-menu').classList.toggle('open'));
document.querySelectorAll('[data-view]').forEach((button) => button.addEventListener('click', () => { selectView(button.dataset.view); $('#view-menu').classList.remove('open'); }));
document.querySelectorAll('[data-close-panel]').forEach((button) => button.addEventListener('click', () => togglePanel(button.closest('.side-panel'))));
$('#fullscreen').addEventListener('click', () => document.fullscreenElement ? document.exitFullscreen() : $('#stage').requestFullscreen());
$('#retry').addEventListener('click', () => chooseScenario(simulation.state.scenarioId));
$('#choose-skill').addEventListener('click', () => { $('#result-modal').classList.remove('open'); $('#skill-picker').classList.add('open'); });
window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') { document.querySelectorAll('.side-panel').forEach((panel) => panel.classList.remove('open')); $('#view-menu').classList.remove('open'); lkj.close(); }
});

window.__speedRegulation = { get simulation() { return simulation; }, get assessment() { return assessment; }, chooseScenario };
render();
requestAnimationFrame(animationFrame);
