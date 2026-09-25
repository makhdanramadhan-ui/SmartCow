// SCS core: logika murni sprinkler, tanpa DOM.
// Dipakai browser (window.SCS) dan Node (module.exports) untuk test.
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SCS = Object.assign(root.SCS || {}, api);
})(typeof self !== 'undefined' ? self : globalThis, () => {
  // Keputusan relay: 'on' | 'off' | 'stay'. Pita hysteresis cegah flapping.
  function decideSprinkler(avg, on, cfg) {
    if (!on && avg >= cfg.threshold) return 'on';
    if (on && avg <= cfg.threshold - cfg.hysteresis) return 'off';
    return 'stay';
  }
  // Mode otomatis eksklusif: 'threshold' ATAU 'schedule', tidak dua-duanya.
  // schedActive = hasil scheduleActive(now, start, dur).
  function autoSrcOf(cfg) {
    if (cfg && (cfg.autoSrc === 'schedule' || cfg.autoSrc === 'threshold')) return cfg.autoSrc;
    if (cfg && cfg.schedOn) return 'schedule'; // migrasi dari format lama
    return 'threshold';
  }
  function decideAuto(avg, on, cfg, schedActive) {
    if (autoSrcOf(cfg) === 'schedule') {
      if (schedActive && !on) return 'on';
      if (!schedActive && on) return 'off';
      return 'stay';
    }
    return decideSprinkler(avg, on, cfg);
  }
  function classify(avg, cfg) {
    if (avg >= cfg.threshold + 1) return 'bahaya';
    if (avg >= cfg.threshold) return 'waspada';
    return 'normal';
  }
  // Rata-rata hanya dari sensor valid (putus = NaN, diabaikan).
  function avgOf(values) {
    const v = values.filter((x) => typeof x === 'number' && isFinite(x));
    if (!v.length) return NaN;
    return v.reduce((a, b) => a + b, 0) / v.length;
  }
  function pruneLogs(logs, max) { return logs.slice(0, max); }
  // Jumlah kartu tampil (0..6). null = belum ada info, tampilkan placeholder.
  function visibleCount(n) {
    if (n == null || !isFinite(n)) return null;
    return Math.max(0, Math.min(6, Math.floor(n)));
  }
  // Judul seksi sensor dari jumlah terdeteksi firmware (null = belum ada info).
  function sensorTitle(n) {
    if (n == null || !isFinite(n)) return '🌡️ Menunggu data sensor…';
    if (n <= 0) return '⚠️ Tidak ada sensor terdeteksi';
    return `🌡️ Sensor terdeteksi: ${n}`;
  }
  // "HH:MM" -> menit sejak tengah malam. NaN bila format salah.
  function hmToMin(s) {
    const m = /^(\d{1,2}):(\d{2})/.exec(s || '');
    if (!m) return NaN;
    const h = +m[1], mi = +m[2];
    if (h > 23 || mi > 59) return NaN;
    return h * 60 + mi;
  }
  // true bila menit sekarang di dalam [start, start+dur), tahan bungkus tengah malam.
  function scheduleActive(cur, start, dur) {
    if (!isFinite(cur) || !isFinite(start) || !(dur > 0)) return false;
    if (start + dur <= 1440) return cur >= start && cur < start + dur;
    return cur >= start || cur < (start + dur) % 1440;
  }
  function logToCsv(r, threshold) {
    const w = new Date(r.t).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
    const st = r.avg >= threshold ? 'PANAS' : 'NORMAL';
    return `"${w}",${r.s.join(',')},${r.avg},${st},${r.spray ? 'ON' : 'OFF'}`;
  }
  return { decideSprinkler, decideAuto, autoSrcOf, classify, avgOf, pruneLogs, logToCsv, hmToMin, scheduleActive, sensorTitle, visibleCount };
});
