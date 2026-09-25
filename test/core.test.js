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
test('multi-slot bertanggal: hanya jalan di tanggalnya', () => {
  // 25 Sep 2026 20:49 WIB = epoch berikut (UTC+7):
  const NOW = Date.UTC(2026, 8, 25, 13, 49); // 20:49 WIB
  const slots = [
    { date: '2026-09-25', start: '20:50', dur: 10 },
    { date: '2026-09-26', start: '09:00', dur: 10 },
  ];
  assert.equal(SCS.slotState(slots[0], NOW), 'future');
  assert.equal(SCS.slotState(slots[0], Date.UTC(2026, 8, 25, 13, 55)), 'active'); // 20:55
  assert.equal(SCS.slotState(slots[0], Date.UTC(2026, 8, 25, 14, 5)), 'past');    // 21:05
  assert.equal(SCS.slotState(slots[1], NOW), 'future'); // beda tanggal -> future
  assert.equal(SCS.anyScheduleActive(NOW, slots), false);
  assert.equal(SCS.anyScheduleActive(Date.UTC(2026, 8, 25, 13, 55), slots), true);
  assert.equal(SCS.anyScheduleActive(Date.UTC(2026, 8, 26, 2, 5), slots), true); // 26-09 09:05 WIB
});

test('multi-slot: slot kemarin tidak ikut nyala hari ini', () => {
  const NOW = Date.UTC(2026, 8, 26, 2, 0); // 26-09 09:00 WIB
  const slots = [{ date: '2026-09-25', start: '09:00', dur: 10 }];
  assert.equal(SCS.anyScheduleActive(NOW, slots), false);
  assert.deepEqual(SCS.prunePastSlots(slots, NOW), []);
});

test('schedulesOf: migrasi format lama + filter rusak', () => {
  const T = '2026-09-25';
  assert.deepEqual(SCS.schedulesOf({ schedules: [{ date: T, start: '09:00', dur: 10 }] }, T), [{ date: T, start: '09:00', dur: 10 }]);
  assert.deepEqual(SCS.schedulesOf({ schedules: [{ start: '09:00', dur: 10 }] }, T), [{ date: T, start: '09:00', dur: 10 }]); // tanpa tanggal -> hari ini
  assert.deepEqual(SCS.schedulesOf({ schedStart: '12:00', schedDur: 10 }, T), [{ date: T, start: '12:00', dur: 10 }]);
  assert.deepEqual(SCS.schedulesOf({ schedules: [{ date: 'xx', start: '09:00', dur: 10 }, { date: T, start: '10:00', dur: 0 }] }, T), [{ date: T, start: '10:00', dur: 1 }]);
  assert.deepEqual(SCS.schedulesOf({}, T), []);
});

test('nextSchedule bertanggal: paling dekat (termasuk yang sedang jalan)', () => {
  const NOW = Date.UTC(2026, 8, 25, 13, 49); // 25-09 20:49 WIB
  const slots = [
    { date: '2026-09-25', start: '20:50', dur: 10 },
    { date: '2026-09-26', start: '09:00', dur: 10 },
  ];
  assert.equal(SCS.nextSchedule(NOW, slots).start, '20:50');
  assert.equal(SCS.nextSchedule(Date.UTC(2026, 8, 25, 13, 55), slots).active, true);
  assert.equal(SCS.nextSchedule(Date.UTC(2026, 8, 26, 3, 0), slots), null); // semua lewat
});

test('wibDateTimeMs: konversi WIB ke epoch', () => {
  assert.equal(SCS.wibDateTimeMs('2026-09-25', '20:50'), Date.UTC(2026, 8, 25, 13, 50));
  assert.ok(!isFinite(SCS.wibDateTimeMs('xx', '20:50')));
});

test('format tanggal Indo + tolak tanggal tak nyata', () => {
  assert.equal(SCS.formatIDDate('2026-09-25'), 'Jum, 25 Sep 2026');
  assert.equal(SCS.formatIDDate('2026-09-26'), 'Sab, 26 Sep 2026');
  assert.equal(SCS.formatIDDate('2026-02-31'), null); // 31 Feb tidak ada
  assert.equal(SCS.formatIDDate('xx'), null);
  assert.equal(SCS.formatIDSlot({ date: '2026-09-25', start: '21:00', dur: 10 }), 'Jum 25 Sep • 21:00 (10 mnt)');
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
