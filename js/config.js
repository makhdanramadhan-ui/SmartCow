// Konfigurasi default — bisa diubah dari UI, tersimpan di localStorage.
// Sumber data tunggal: Firebase (ESP32 menulis, web membaca + kirim perintah).
const DEFAULT_CFG = {
  threshold: 30.0,
  hysteresis: 1.0,
  maxDuration: 120,   // detik (mode suhu saja)
  cooldown: 60,       // detik (mode suhu saja)
  mode: 'auto',       // auto | manual
  autoSrc: 'threshold', // threshold | schedule (eksklusif, pilih salah satu)
  schedOn: false,       // turunan dari autoSrc, disimpan untuk kompatibel firmware lama
  // Mode jadwal: daftar semprot per hari, tiap slot {start:'HH:MM' WIB, dur:menit}.
  // Durasi = lama nyala slot itu. Tanpa cooldown. Maks 6 slot.
  schedules: [
    { start: '09:00', dur: 10 },
    { start: '14:00', dur: 10 },
    { start: '18:00', dur: 10 },
  ],
};
let CFG = { ...DEFAULT_CFG, ...(JSON.parse(localStorage.getItem('scs_cfg') || '{}')) };
// Migrasi: dulu pakai checkbox schedOn + 1 jadwal, sekarang radio autoSrc + daftar slot.
if (!CFG.autoSrc) CFG.autoSrc = CFG.schedOn ? 'schedule' : 'threshold';
CFG.schedOn = CFG.autoSrc === 'schedule';
if (!Array.isArray(CFG.schedules) || !CFG.schedules.length) {
  if (CFG.schedStart && CFG.schedDur) CFG.schedules = [{ start: CFG.schedStart, dur: CFG.schedDur }];
  else CFG.schedules = [...DEFAULT_CFG.schedules];
}
delete CFG.schedStart; delete CFG.schedDur;

function saveCfg(){ localStorage.setItem('scs_cfg', JSON.stringify(CFG)); }
