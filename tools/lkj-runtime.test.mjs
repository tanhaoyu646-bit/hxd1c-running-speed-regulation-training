import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  SCENARIOS,
  absoluteKilometerAt,
  lineLimitAt,
  lkjControlLimit,
  routeFacilitiesForScenario,
  signalAt,
} from '../scripts/speedRegulationConfig.js';
import { LKJ_CHART, LKJ_QUERY_MENU } from '../scripts/lkjRuntime.js';

test('LKJ固定显示后方1km与前方不少于4km', () => {
  const history = (LKJ_CHART.position - LKJ_CHART.left) / LKJ_CHART.pixelsPerMeter;
  const forward = (LKJ_CHART.right - LKJ_CHART.position) / LKJ_CHART.pixelsPerMeter;
  assert.ok(Math.abs(history - 1000) < 0.001);
  assert.ok(forward >= 4000);
  assert.equal(LKJ_CHART.speedMaximum, 140);
  assert.equal(LKJ_CHART.speedTick, 20);
});

test('LKJ查询顺序与数字快捷键保持一致', () => {
  assert.deepEqual(LKJ_QUERY_MENU.map((item) => item.slice(1)), [
    ['当前揭示', '1'], ['工况显示', '2'], ['全部揭示', '3'], ['设备状态', '4'],
    ['检修参数', '5'], ['设定参数', '6'], ['返回监控', '0'],
  ]);
});

test('绝对公里标、前方信号和控制曲线共用场景数据', () => {
  for (const scenario of Object.values(SCENARIOS)) {
    assert.equal(absoluteKilometerAt(scenario, scenario.entryDistance).toFixed(3), '226.091');
    assert.equal(signalAt(scenario, 0), scenario.signals[0]);
    assert.equal(signalAt(scenario, scenario.signals[0].distance + 1), scenario.signals[1]);
    assert.equal(lineLimitAt(scenario, 0), 120);
    assert.equal(lkjControlLimit(scenario, scenario.entryDistance), 45);
    assert.ok(lkjControlLimit(scenario, scenario.entryDistance - 500) > 45);
  }
});

test('LKJ桥隧标记来自原线路累计里程并随技能起点换算', () => {
  const oneStage = routeFacilitiesForScenario(SCENARIOS.oneStage);
  const twoStage = routeFacilitiesForScenario(SCENARIOS.twoStage);
  const oneBridge = oneStage.find((item) => item.id === 'dashanpu-bridge');
  const twoBridge = twoStage.find((item) => item.id === 'dashanpu-bridge');
  const tunnel = twoStage.find((item) => item.id === 'neiyi-tunnel');
  assert.equal(oneBridge.start, 3124);
  assert.equal(twoBridge.start, 3124);
  assert.equal(tunnel.start, 6349);
});

test('LKJ使用140km/h标尺余量并持续保留完整历史窗口', async () => {
  const source = await readFile(new URL('../scripts/lkjRuntime.js', import.meta.url), 'utf8');
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const css = await readFile(new URL('../styles/speed-regulation.css', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /slice\(-250\)/);
  assert.match(source, /speedMaximum: 140/);
  assert.match(source, /lkj-speed-scale-bg/);
  assert.match(source, /lkj-native-limit-value/);
  assert.doesNotMatch(source, /lkj-native-line-limit/);
  assert.match(source, /routeFacilitiesForScenario/);
  assert.match(html, /id="result-trace"/);
  assert.match(css, /body\.mobile-controls-enabled \.lkj-dock[^{]*\{[^}]*left:max\(2px,env\(safe-area-inset-left\)\)[^}]*width:min\(30vw/);
  assert.match(css, /\.lkj-state-lamps span\{[^}]*white-space:nowrap/);
  assert.match(css, /body\.mobile-controls-enabled \.lkj-state-lamps\{left:93\.6%;width:6\.1%\}/);
});
