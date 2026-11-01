import { LKJ_KEYS } from './speedRegulationConfig.js';

const pct = (value, total) => `${value / total * 100}%`;
const fmt = (value, digits = 0) => Number(value || 0).toFixed(digits);

const MENU = Object.freeze([
  ['condition', '工况显示'],
  ['current', '当前揭示'],
  ['all', '全部揭示'],
  ['equipment', '设备状态'],
  ['parameters', '设定参数'],
  ['records', '运行记录'],
  ['return', '返回监控'],
]);

export class LkjRuntime {
  constructor(root, simulation) {
    this.root = root;
    this.simulation = simulation;
    this.screen = root.querySelector('.lkj-screen');
    this.page = 'main';
    this.menuIndex = 0;
    this.notice = '';
    this.open = false;
    this.buildKeys();
    root.querySelector('[data-lkj-close]').addEventListener('click', () => this.close());
  }

  buildKeys() {
    const keypad = this.root.querySelector('.lkj-keypad');
    for (const [id, label, x, y, width, height] of LKJ_KEYS) {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.key = id;
      button.setAttribute('aria-label', label);
      Object.assign(button.style, { left: pct(x, 800), top: pct(y, 615), width: pct(width, 800), height: pct(height, 615) });
      button.addEventListener('pointerdown', () => button.classList.add('pressed'));
      ['pointerup', 'pointercancel', 'pointerleave'].forEach((name) => button.addEventListener(name, () => button.classList.remove('pressed')));
      button.addEventListener('click', () => this.handleKey(id));
      keypad.append(button);
    }
  }

  show() {
    this.open = true;
    this.root.classList.add('open');
    this.root.setAttribute('aria-hidden', 'false');
    this.simulation.command('lkj-open');
    this.render();
  }

  close() {
    this.open = false;
    this.root.classList.remove('open');
    this.root.setAttribute('aria-hidden', 'true');
  }

  handleKey(id) {
    if (id === 'alarm') {
      this.simulation.command('lkj-ack');
      this.flash('警惕报警已确认');
      return;
    }
    if (id === 'relief') {
      this.simulation.command('lkj-relief');
      this.flash(this.simulation.state.lkjForcedBrake ? '速度未降至允许值，缓解无效' : '制动指令已缓解');
      return;
    }
    if (id === 'query') { this.page = 'menu'; this.menuIndex = 0; this.render(); return; }
    if (id === 'setting') { this.page = 'parameters'; this.render(); return; }
    if (id === 'dump') { this.page = 'records'; this.render(); return; }
    if (id === 'left') { this.page = this.page === 'main' ? 'main' : 'menu'; this.render(); return; }
    if (id === 'right' && this.page === 'menu') { this.page = MENU[this.menuIndex][0] === 'return' ? 'main' : MENU[this.menuIndex][0]; this.render(); return; }
    if (id === 'up' && this.page === 'menu') { this.menuIndex = (this.menuIndex - 1 + MENU.length) % MENU.length; this.render(); return; }
    if (id === 'down' && this.page === 'menu') { this.menuIndex = (this.menuIndex + 1) % MENU.length; this.render(); return; }
    if (id === 'confirm' && this.page === 'menu') {
      const page = MENU[this.menuIndex][0];
      this.page = page === 'return' ? 'main' : page;
      this.render();
      return;
    }
    if (id.startsWith('digit-') && this.page === 'menu') {
      const index = Number(id.slice(6)) - 1;
      if (index >= 0 && index < MENU.length) {
        this.menuIndex = index;
        this.page = MENU[index][0] === 'return' ? 'main' : MENU[index][0];
        this.render();
        return;
      }
    }
    if ((id === 'up' || id === 'down') && this.page === 'records') {
      this.recordOffset = Math.max(0, Math.min(this.simulation.state.events.length - 1, (this.recordOffset || 0) + (id === 'up' ? 1 : -1)));
      this.render();
      return;
    }
    if (id === 'confirm' && this.page !== 'main') { this.page = 'main'; this.render(); return; }
    if (id === 'digit-3') { this.page = 'current'; this.render(); return; }
    if (id === 'digit-4') { this.page = 'all'; this.render(); return; }
    if (id === 'digit-5') { this.page = 'condition'; this.render(); return; }
    if (id === 'digit-0') { this.page = 'equipment'; this.render(); return; }
    if (id === 'digit-8') { this.flash(`当前里程 ${fmt(this.simulation.state.distance / 1000, 3)} km`); return; }
    if (id === 'digit-7') { this.flash('开车键有效：运行监控中'); return; }
    if (id === 'unlock') { this.flash('当前无解锁条件'); return; }
    if (id.startsWith('digit-')) { this.flash('运行监控中，当前按键无需操作'); return; }
    this.flash('该键在当前页面无对应操作');
  }

  flash(message) {
    this.notice = message;
    this.render();
    clearTimeout(this.noticeTimer);
    this.noticeTimer = setTimeout(() => { this.notice = ''; this.render(); }, 1300);
  }

  render() {
    const s = this.simulation.state;
    const scenario = this.simulation.scenario;
    if (this.page === 'menu') {
      this.screen.innerHTML = `<div class="lkj-page"><header>查询选择</header><ol>${MENU.map(([id, label], index) => `<li class="${index === this.menuIndex ? 'selected' : ''}"><span>${index + 1}</span>${label}<em>${id === 'records' ? s.events.length : ''}</em></li>`).join('')}</ol><footer>↑↓选择　确认进入　←返回</footer></div>`;
    } else if (this.page === 'condition') {
      this.screen.innerHTML = this.detailPage('工况显示', [
        ['速度', `${fmt(s.speed, 1)} km/h`], ['牵引手柄', `${s.traction} 级`], ['自阀', `${s.autoBrake} 位`],
        ['列车管', `${fmt(s.trainPipe)} kPa`], ['制动缸', `${fmt(s.brakeCylinder)} kPa`], ['网压', `${fmt(s.netVoltage / 100, 1)} kV`], ['牵引电流', `${fmt(s.tractionCurrent)} A`], ['运行里程', `${fmt(s.distance)} m`],
      ]);
    } else if (this.page === 'equipment') {
      this.screen.innerHTML = this.detailPage('设备状态', [
        ['主机', '正常'], ['速度通道', '正常'], ['压力通道', '正常'], ['信号通道', '正常'], ['记录单元', '正常'], ['制动接口', s.lkjForcedBrake ? '输出中' : '正常'],
      ]);
    } else if (this.page === 'parameters') {
      this.screen.innerHTML = this.detailPage('设定参数（本考评锁定）', [
        ['车种', '电力机车'], ['列车类型', '旅客列车'], ['司机号', '考评账号'], ['本/补', '本务'], ['线路号', '教学线'], ['载频', '自动'],
      ]);
    } else if (this.page === 'current' || this.page === 'all') {
      this.screen.innerHTML = this.detailPage(this.page === 'current' ? '当前揭示' : '全部揭示', [
        ['前方目标', scenario.entrySignalName], ['目标距离', `${fmt(Math.max(0, scenario.entryDistance - s.distance))} m`], ['目标速度', `≤ ${scenario.maximumEntrySpeed} km/h`], ['信号', this.aspectLabel(s.signal.aspect)], ['线路限速', '120 km/h'], ['临时限速', '无'],
      ]);
    } else if (this.page === 'records') {
      const records = s.events.slice(0, Math.max(0, s.events.length - (this.recordOffset || 0))).slice(-6).reverse().map((event) => `<li><span>${this.eventLabel(event.type)}</span><b>${fmt(event.elapsed)}s</b><em>${fmt(event.speed)} km/h</em></li>`).join('') || '<li>暂无记录</li>';
      this.screen.innerHTML = `<div class="lkj-page records"><header>运行记录</header><ul>${records}</ul><footer>↑↓翻阅　←返回　转储键刷新</footer></div>`;
    } else {
      this.screen.innerHTML = this.mainPage(s, scenario);
    }
    this.screen.insertAdjacentHTML('afterbegin', `<div class="lkj-native-aspect ${s.signal.aspect}"></div><b class="lkj-native-speed">${fmt(s.speed)}</b><b class="lkj-native-limit">${fmt(s.lkjLimit)}</b><b class="lkj-native-distance">${fmt(Math.max(0, scenario.entryDistance - s.distance))}</b><b class="lkj-native-station">K226+091</b><b class="lkj-native-km">${fmt(s.distance / 1000, 3)}</b><time class="lkj-native-time">${new Date().toLocaleTimeString('zh-CN', { hour12: false })}</time>`);
    if (this.notice) this.screen.insertAdjacentHTML('beforeend', `<div class="lkj-notice">${this.notice}</div>`);
  }

  mainPage(s, scenario) {
    const levelLabels = { normal: '监控', warning: '报警', unload: '卸载', service: '常用制动', emergency: '紧急制动' };
    const speedPoints = s.samples.slice(-250).map((sample) => {
      const x = 191 + (sample.distance - s.distance) * 545 / 2400;
      return x >= 64 && x <= 736 ? `${x.toFixed(1)},${(390 - Math.min(140, sample.speed) / 140 * 330).toFixed(1)}` : null;
    }).filter(Boolean).join(' ');
    const limitY = 390 - Math.min(140, s.lkjLimit) / 140 * 330;
    return `<div class="lkj-native-monitor level-${s.lkjLevel}">
      <svg viewBox="0 0 800 615" preserveAspectRatio="none" aria-label="LKJ运行监控曲线"><polyline class="lkj-native-limit-line" points="64,${limitY} 736,${limitY}"/><line class="lkj-native-position-line" x1="191" y1="60" x2="191" y2="390"/><polyline class="lkj-native-speed-line" points="${speedPoints}"/></svg>
      <aside class="lkj-native-equipment"><b>原边电流 <em>${fmt(s.tractionCurrent)} A</em></b><b>列车管压力 <em>${fmt(s.trainPipe)} kPa</em></b><b>制动缸压力 <em>${fmt(s.brakeCylinder)} kPa</em></b><b>均衡风缸 <em>${fmt(s.equalizingReservoir)} kPa</em></b><b>网压 <em>${fmt(s.netVoltage / 100, 1)} kV</em></b><b>工况 <em>${s.traction > 0 ? `牵引${s.traction}级` : s.traction < 0 ? `电制${-s.traction}级` : '惰行'}</em></b><b>通道速度 <em>${fmt(s.speed)} km/h</em></b></aside>
      <div class="lkj-native-status">${levelLabels[s.lkjLevel]} · ${this.aspectLabel(s.signal.aspect)}</div>
    </div>`;
  }

  detailPage(title, rows) {
    return `<div class="lkj-page"><header>${title}</header><dl>${rows.map(([key, value]) => `<div><dt>${key}</dt><dd>${value}</dd></div>`).join('')}</dl><footer>查询：菜单　←：返回</footer></div>`;
  }

  aspectLabel(aspect) {
    return ({ green: '绿灯', 'green-yellow': '绿黄灯', 'double-yellow': '双黄灯', yellow: '黄灯', red: '红灯' })[aspect] || aspect;
  }

  eventLabel(type) {
    return ({ 'attempt-start': '考评开始', 'auto-brake': '自阀操作', traction: '牵引操作', callout: '呼唤确认', 'lkj-level': '监控状态', 'entry-pass': '通过进站信号', 'lkj-ack': '警惕确认' })[type] || type;
  }
}
