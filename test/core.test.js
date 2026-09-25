// TDD seam: logika murni sprinkler (tanpa DOM). Dijalankan: node --test test/
const test = require('node:test');
const assert = require('node:assert/strict');
const SCS = require('../js/core.js');

test('keputusan NYALA saat avg >= threshold (dari mati)', () => {
  assert.equal(SCS.decideSprinkler(30.0, false, { threshold: 30.0, hysteresis: 1.0 }), 'on');
  assert.equal(SCS.decideSprinkler(31.5, false, { threshold: 30.0, hysteresis: 1.0 }), 'on');
});

test('tetap MATI di bawah threshold', () => {
  assert.equal(SCS.decideSprinkler(29.9, false, { threshold: 30.0, hysteresis: 1.0 }), 'stay');
});

test('keputusan MATI saat avg <= threshold - hysteresis (dari nyala)', () => {
  assert.equal(SCS.decideSprinkler(29.0, true, { threshold: 30.0, hysteresis: 1.0 }), 'off');
});

test('tetap NYALA di dalam pita hysteresis (anti flapping relay)', () => {
  assert.equal(SCS.decideSprinkler(29.5, true, { threshold: 30.0, hysteresis: 1.0 }), 'stay');
});

test('klasifikasi status kandang', () => {
  assert.equal(SCS.classify(28.0, { threshold: 30.0 }), 'normal');
  assert.equal(SCS.classify(30.0, { threshold: 30.0 }), 'waspada');
  assert.equal(SCS.classify(31.2, { threshold: 30.0 }), 'bahaya');
});

test('rata-rata mengabaikan sensor putus (NaN)', () => {
  assert.equal(SCS.avgOf([30, NaN, 30, 30, 30, 30]), 30);
  assert.ok(Number.isNaN(SCS.avgOf([NaN, NaN])));
});

test('prune log keeps newest 120', () => {
  const logs = Array.from({ length: 130 }, (_, i) => ({ t: i }));
  assert.equal(SCS.pruneLogs(logs, 120).length, 120);
  assert.equal(SCS.pruneLogs(logs, 120)[0].t, 0);
});

test('baris CSV log valid', () => {
  const row = SCS.logToCsv({ t: 0, s: [30.1, 30.2, 30.3, 30.4, 30.5, 30.6], avg: 30.3, spray: 1 }, 30.0);
  assert.match(row, /^".+",30\.1,30\.2,30\.3,30\.4,30\.5,30\.6,30\.3,PANAS,ON$/);
});

test('jadwal aktif di dalam window', () => {
  assert.equal(SCS.scheduleActive(720, 720, 10), true);
  assert.equal(SCS.scheduleActive(729, 720, 10), true);
  assert.equal(SCS.scheduleActive(730, 720, 10), false);
  assert.equal(SCS.scheduleActive(719, 720, 10), false);
});

test('jadwal bungkus tengah malam', () => {
  assert.equal(SCS.scheduleActive(4, 1435, 10), true);
  assert.equal(SCS.scheduleActive(1439, 1435, 10), true);
  assert.equal(SCS.scheduleActive(5, 1435, 10), false);
  assert.equal(SCS.scheduleActive(10, 1435, 10), false);
});

test('hmToMin parse jam', () => {
  assert.equal(SCS.hmToMin('12:30'), 750);
  assert.ok(Number.isNaN(SCS.hmToMin('xx')));
});

test('durasi nol berarti jadwal mati', () => {
  assert.equal(SCS.scheduleActive(720, 720, 0), false);
});

test('mode eksklusif: threshold abaikan jadwal', () => {
  const cfg = { threshold: 30.0, hysteresis: 1.0, autoSrc: 'threshold' };
  assert.equal(SCS.decideAuto(31.5, false, cfg, true), 'on');
  assert.equal(SCS.decideAuto(29.9, false, cfg, true), 'stay');
  assert.equal(SCS.decideAuto(29.0, true, cfg, true), 'off');
});

test('mode eksklusif: schedule abaikan suhu', () => {
  const cfg = { threshold: 30.0, hysteresis: 1.0, autoSrc: 'schedule' };
  assert.equal(SCS.decideAuto(25.0, false, cfg, true), 'on');
  assert.equal(SCS.decideAuto(35.0, true, cfg, false), 'off');
  assert.equal(SCS.decideAuto(35.0, true, cfg, true), 'stay');
});

test('migrasi schedOn lama ke autoSrc', () => {
  assert.equal(SCS.autoSrcOf({ schedOn: true }), 'schedule');
  assert.equal(SCS.autoSrcOf({ schedOn: false }), 'threshold');
  assert.equal(SCS.autoSrcOf({ autoSrc: 'schedule', schedOn: false }), 'schedule');
});
test('jumlah kartu tampil ikut sensor terdeteksi', () => {
  assert.equal(SCS.visibleCount(null), null);
  assert.equal(SCS.visibleCount(6), 6);
  assert.equal(SCS.visibleCount(2), 2);
  assert.equal(SCS.visibleCount(0), 0);
  assert.equal(SCS.visibleCount(9), 6);
});

test('judul info sensor', () => {
  assert.equal(SCS.sensorTitle(null), '🌡️ Menunggu data sensor…');
  assert.equal(SCS.sensorTitle(0), '⚠️ Tidak ada sensor terdeteksi');
  assert.equal(SCS.sensorTitle(6), '🌡️ Sensor terdeteksi: 6');
});
