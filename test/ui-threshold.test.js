const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const C = require('../js/control.js');
const T = require('../js/telemetry.js');
const app = fs.readFileSync(path.join(__dirname, '../js/app.js'), 'utf8');
// Execute the real rendering functions against a small DOM/canvas double.
const source = app.slice(app.indexOf('const profileOf ='), app.indexOf('function markSettingsDirty'))
  + app.slice(app.indexOf('function tempColor('), app.indexOf('function refreshTelemetry('))
  + app.slice(app.indexOf('function drawChart('), app.indexOf("window.addEventListener('resize', drawChart)"));

function setup(basis = 'temperature') {
  const elements = new Map();
  function element() {
    const children = new Map();
    return { textContent: '', className: '', hidden: false, style: {}, dataset: {},
      classList: { toggle() {} },
      querySelector(selector) { if (!children.has(selector)) children.set(selector, element()); return children.get(selector); } };
  }
  const $ = id => { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); };
  const wrappers = ['temperature', 'thi'].map(b => Object.assign(element(), { dataset: { thresholdBasis: b }, hidden: true }));
  const raw = { ts: Date.now(), validMask: 63, validCount: 6, avg: 30,
    t1: 28, t2: 29, t3: 30, t4: 30, t5: 31, t6: 32,
    h1: 60, h2: 65, h3: 75, h4: 80, humidityValidMask: 15 };
  const view = T.view(raw, raw.ts);
  const labels = [], dashes = [];
  const canvas = $('chart');
  canvas.clientWidth = 600;
  canvas.getContext = () => ({ clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {},
    fillText(text) { labels.push(text); }, setLineDash(value) { dashes.push(value); } });
  $('chartMetric').value = 'temperature';
  $('showAvg').checked = true;
  const saved = C.normalize({ controlBasis: basis, profiles: {
    temperature: { threshold: 31.5, hysteresis: 1 }, thi: { threshold: 79.5, hysteresis: 2 } } });
  const context = vm.createContext({ $, appliedCfg: saved, controlLoaded: true, SCSTelemetry: T,
    sensorView: view, temps: view.s, humidities: view.h, telemetry: raw,
    document: { documentElement: {}, querySelectorAll: () => wrappers },
    getComputedStyle: () => ({ getPropertyValue: value => value }),
    chartTheme: () => ({ grid: 'grid', txt: 'txt', empty: 'empty', threshold: 'threshold', thi: 'thi' }),
    COLORS: Array(6).fill('color'), AVG_COLOR: 'avg', fmtValue: value => T.finite(value) ? value.toFixed(1) : '—',
    history: [0, 1].map(i => ({ t: Date.now() - 1000 + i * 500, s: view.s, h: view.h, thi: view.thi, avg: view.avg, humidityAvg: view.humidityAvg })) });
  vm.runInContext(source, context);
  return { $, wrappers, context, labels, dashes,
    render: () => context.renderSensors(), draw: () => { labels.length = 0; dashes.length = 0; context.drawChart(); } };
}

test('saved Suhu shows only the user temperature threshold and neutral THI monitoring', () => {
  const ui = setup(); ui.render();
  assert.deepEqual(ui.wrappers.map(el => el.hidden), [false, true]);
  assert.equal(ui.$('thresholdLabel').textContent, '31.5°C');
  assert.equal(ui.$('avgStatus').textContent, 'DI BAWAH AMBANG SUHU');
  assert.equal(ui.$('thiValue').textContent, '81.4');
  assert.equal(ui.$('thiStatus').textContent, 'MONITORING THI');
  assert.equal(ui.$('thiStatus').className, 'status-pill neutral');
});

test('saved THI shows only the user THI threshold and neutral temperature details/colors', () => {
  const ui = setup('thi'); ui.render();
  assert.deepEqual(ui.wrappers.map(el => el.hidden), [true, false]);
  assert.equal(ui.$('thiThresholdLabel').textContent, '79.5');
  assert.equal(ui.$('thiStatus').textContent, 'THRESHOLD THI TERCAPAI');
  assert.equal(ui.$('avgStatus').textContent, 'MONITORING SUHU');
  assert.equal(ui.$('avgStatus').className, 'status-pill neutral');
  for (let i = 0; i < 6; i++) {
    assert.equal(ui.$('sensor' + i).querySelector('.s-state').textContent, 'TERBACA · MONITORING');
    assert.equal(ui.$('sensor' + i).querySelector('.s-temp').style.color, '--txt');
  }
});

test('draft basis/threshold edits cannot change saved summary visibility or comparisons', () => {
  const ui = setup();
  ui.context.CFG = C.normalize({ controlBasis: 'thi', threshold: 88 });
  ui.render();
  assert.deepEqual(ui.wrappers.map(el => el.hidden), [false, true]);
  assert.equal(ui.$('thresholdLabel').textContent, '31.5°C');
  assert.equal(ui.$('thiStatus').textContent, 'MONITORING THI');
  ui.context.appliedCfg = C.normalize({ controlBasis: 'thi', threshold: 88 });
  ui.render();
  assert.deepEqual(ui.wrappers.map(el => el.hidden), [true, false]);
  assert.equal(ui.$('thiThresholdLabel').textContent, '88.0');
  assert.equal(ui.$('thiStatus').textContent, 'DI BAWAH THRESHOLD THI');
});

test('unloaded configuration hides both thresholds rather than displaying cached defaults', () => {
  const ui = setup(); ui.context.controlLoaded = false; ui.render();
  assert.deepEqual(ui.wrappers.map(el => el.hidden), [true, true]);
  assert.equal(ui.$('thresholdLabel').textContent, '—');
  assert.equal(ui.$('thiThresholdLabel').textContent, '—');
  assert.equal(ui.$('avgStatus').textContent, 'MONITORING SUHU');
  assert.equal(ui.$('thiStatus').textContent, 'MONITORING THI');
});

test('inactive partial temperature stays monitoring; missing/stale data is never labeled normal', () => {
  const ui = setup('thi');
  const partial = T.view({ ...ui.context.telemetry, validMask: 31, validCount: 5 });
  Object.assign(ui.context, { sensorView: partial, temps: partial.s, humidities: partial.h });
  ui.render();
  assert.equal(ui.$('avgStatus').textContent, 'DATA SUHU PARSIAL · MONITORING');
  assert.equal(ui.$('avgStatus').className, 'status-pill neutral');
  assert.equal(ui.$('thiStatus').textContent, 'PERLU 6 DS + 4 DHT VALID');
  assert.equal(ui.$('sensor5').querySelector('.s-state').textContent, 'BELUM TERBACA');
  const stale = T.view(ui.context.telemetry, ui.context.telemetry.ts + 20000);
  Object.assign(ui.context, { sensorView: stale, temps: stale.s, humidities: stale.h });
  ui.render();
  assert.equal(ui.$('avgStatus').textContent, 'DATA BELUM TERSEDIA');
  assert.equal(ui.$('avgTemp').textContent, '—');
  assert.equal(ui.$('thiValue').textContent, '—');
  assert.equal(ui.$('sensor0').querySelector('.s-state').textContent, 'DATA LAMA');
});

test('chart draws a user threshold only for the saved basis, never RH or inactive metrics', () => {
  for (const basis of ['temperature', 'thi']) {
    const ui = setup(basis);
    for (const metric of ['temperature', 'humidity', 'thi']) {
      ui.$('chartMetric').value = metric; ui.draw();
      const expected = metric === basis ? [basis === 'thi' ? 'ambang 79.5 THI' : 'ambang 31.5°C'] : [];
      assert.deepEqual(ui.labels.filter(label => label.startsWith('ambang ')), expected);
      assert.equal(ui.dashes.some(dash => dash.length > 0), metric === basis);
    }
    ui.context.controlLoaded = false; ui.$('chartMetric').value = basis; ui.draw();
    assert.equal(ui.labels.some(label => label.startsWith('ambang ')), false);
  }
});
