// Normalisasi sensor dan freshness. Tidak mengganti data hilang dengan nol.
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SCSTelemetry = api;
})(typeof self !== 'undefined' ? self : globalThis, () => {
  const finite = (v) => typeof v === 'number' && Number.isFinite(v);
  const temperature = (v) => finite(v) && v >= -55 && v <= 125;
  const humidity = (v) => finite(v) && v >= 0 && v <= 100;
  const average = (values) => {
    const good = values.filter(finite);
    return good.length ? good.reduce((a, b) => a + b, 0) / good.length : null;
  };
  const ageAt = (ages, index, extra) => finite(ages?.[index]) && ages[index] >= 0 ? ages[index] + extra : null;
  function view(raw, now = Date.now()) {
    raw = raw || {};
    const age = finite(raw.ts) ? now - raw.ts : Infinity;
    const measured = finite(raw.measuredTs) && raw.measuredTs > 1700000000000 ? raw.measuredTs : raw.ts;
    const elapsed = finite(measured) ? Math.max(0, now - measured) : Infinity;
    const online = age >= -10000 && age < 15000 && elapsed < 15000 && measured <= now + 10000;
    const dsMask = Number.isInteger(raw.validMask) ? raw.validMask : null;
    const rhMask = Number.isInteger(raw.humidityValidMask) ? raw.humidityValidMask : 0;
    const legacyCount = Number.isInteger(raw.n) ? Math.max(0, Math.min(6, raw.n)) : 6;
    const s = [], h = [], d = [], dsStates = [], rhStates = [];
    for (let i = 0; i < 6; i++) {
      const value = raw['t' + (i + 1)];
      const eligible = temperature(value) && (dsMask === null ? i < legacyCount : !!(dsMask & (1 << i)));
      const sampleAge = ageAt(raw.temperatureAgeMs, i, elapsed);
      const fresh = online && eligible && (sampleAge === null || sampleAge < (i < 3 ? 3000 : 10000));
      s.push(fresh ? value : null);
      dsStates.push(fresh ? 'online' : ((!online && finite(raw.ts)) || eligible ? 'stale' : 'missing'));
    }
    for (let i = 0; i < 4; i++) {
      const value = raw['h' + (i + 1)];
      const eligible = humidity(value) && !!(rhMask & (1 << i));
      const sampleAge = ageAt(raw.humidityAgeMs, i, elapsed);
      const fresh = online && eligible && (sampleAge === null || sampleAge < (i < 2 ? 7000 : 10000));
      h.push(fresh ? value : null);
      const companion = raw['d' + (i + 1)];
      d.push(fresh && finite(companion) && companion >= -40 && companion <= 80 ? companion : null);
      rhStates.push(fresh ? 'online' : ((!online && finite(raw.ts)) || eligible ? 'stale' : 'missing'));
    }
    const validCount = s.filter(finite).length;
    const humidityValidCount = h.filter(finite).length;
    // Rata-rata firmware hanya dipercaya selama semua sampel yang menyusunnya masih fresh.
    const backendCount = Number.isInteger(raw.validCount) ? raw.validCount : validCount;
    const avg = validCount && backendCount === validCount && temperature(raw.avg) ? raw.avg : average(s);
    const leftAge = finite(raw.leftAgeMs) ? raw.leftAgeMs + elapsed : null;
    return { s, h, d, avg, humidityAvg: average(h), validCount, humidityValidCount,
      complete: validCount === 6, humidityComplete: humidityValidCount === 4,
      dsStates, rhStates, online, age, ts: raw.ts || null,
      leftOnline: online && raw.leftOnline === true && (leftAge === null || leftAge < 10000),
      legacy: dsMask === null, ssr: online && (raw.ssr === 0 || raw.ssr === 1) ? raw.ssr : null };
  }
  function logRow(raw) {
    const v = view(raw, raw.ts);
    return { t: raw.ts, s: v.s, h: v.h, d: v.d, avg: v.avg, humidityAvg: v.humidityAvg,
      spray: raw.ssr === 1 ? 1 : 0, validMask: raw.validMask, humidityValidMask: raw.humidityValidMask };
  }
  return { view, logRow, finite, average };
});
