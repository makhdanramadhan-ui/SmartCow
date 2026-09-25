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
  // Daftar slot jadwal ternormalisasi: [{date:'YYYY-MM-DD', start:'HH:MM', dur:menit}].
  // Migrasi: format lama {start,dur} tanpa tanggal -> diberi tanggal hari ini (param todayStr).
  // Slot rusak / tanggal tak valid dibuang. Maks 6, urut tanggal+jam.
  function schedulesOf(cfg, todayStr) {
    let raw = [];
    if (cfg && Array.isArray(cfg.schedules)) raw = cfg.schedules;
    else if (cfg && typeof cfg.schedStart === 'string') raw = [{ start: cfg.schedStart, dur: cfg.schedDur }];
    const out = [];
    raw.forEach((s) => {
      if (!s || typeof s.start !== 'string' || !isFinite(hmToMin(s.start))) return;
      let date = s.date || '';
      if (!date) { if (!todayStr) return; date = todayStr; } // slot lama tanpa tanggal -> hari ini
      else if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;    // tanggal rusak -> buang
      const dur = Math.min(180, Math.max(1, Math.round(+s.dur || 0)));
      if (!(dur > 0)) return;
      if (!out.some((o) => o.date === date && o.start === s.start)) out.push({ date, start: s.start, dur });
    });
    out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : hmToMin(a.start) - hmToMin(b.start)));
    return out.slice(0, 6);
  }
  // 'YYYY-MM-DD' WIB hari ini (Asia/Jakarta, UTC+7 tetap).
  function wibDateStr(d) {
    d = d || new Date();
    const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d);
    const g = (t) => p.find((x) => x.type === t).value;
    return `${g('year')}-${g('month')}-${g('day')}`;
  }
  // Epoch-ms untuk tanggal+jam WIB. WIB = UTC+7 tanpa DST.
  function wibDateTimeMs(dateStr, timeStr) {
    const D = (dateStr || '').split('-').map(Number);
    const T = (timeStr || '').split(':').map(Number);
    if (D.length < 3 || T.length < 2 || D.some((x) => !isFinite(x)) || T.some((x) => !isFinite(x))) return NaN;
    return Date.UTC(D[0], D[1] - 1, D[2], T[0] - 7, T[1]);
  }
  // Status slot thd nowMs: 'active' | 'future' | 'past'.
  function slotState(s, nowMs) {
    const t0 = wibDateTimeMs(s.date, s.start);
    if (!isFinite(t0)) return 'past';
    if (nowMs < t0) return 'future';
    if (nowMs < t0 + s.dur * 60000) return 'active';
    return 'past';
  }
  // true bila ada SATU slot pun yang sedang berjalan. Durasi tiap slot = lama nyala (tanpa cooldown).
  function anyScheduleActive(nowMs, slots) {
    return (slots || []).some((s) => slotState(s, nowMs) === 'active');
  }
  // Slot berikutnya (yang aktif / paling dekat di depan). null bila tidak ada.
  function nextSchedule(nowMs, slots) {
    let best = null;
    (slots || []).forEach((s) => {
      const t0 = wibDateTimeMs(s.date, s.start);
      if (!isFinite(t0) || slotState(s, nowMs) === 'past') return;
      if (!best || t0 < best.t0) best = { date: s.date, start: s.start, dur: s.dur, t0, active: nowMs >= t0 };
    });
    return best;
  }
  // Buang slot yang window-nya sudah lewat seluruhnya (autoreset harian).
  function prunePastSlots(slots, nowMs) {
    return (slots || []).filter((s) => slotState(s, nowMs) !== 'past');
  }
  function logToCsv(r, threshold) {
    const w = new Date(r.t).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
    const st = r.avg >= threshold ? 'PANAS' : 'NORMAL';
    return `"${w}",${r.s.join(',')},${r.avg},${st},${r.spray ? 'ON' : 'OFF'}`;
  }
  return { decideSprinkler, decideAuto, autoSrcOf, classify, avgOf, pruneLogs, logToCsv, hmToMin, scheduleActive, schedulesOf, anyScheduleActive, nextSchedule, prunePastSlots, slotState, wibDateStr, wibDateTimeMs, sensorTitle, visibleCount };
});
