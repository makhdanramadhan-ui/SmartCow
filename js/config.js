// Konfigurasi default — bisa diubah dari UI, tersimpan di localStorage.
// Sumber data tunggal: Firebase (ESP32 menulis, web membaca + kirim perintah).
function todayWIB() {
  try {
    if (window.SCS && SCS.wibDateStr) return SCS.wibDateStr();
  } catch {}
  return new Date().toISOString().slice(0, 10);
}
// Template awal: contoh 3× sehari (09:00, 14:00, 18:00 WIB).
function defaultSchedules() {
  const t = todayWIB();
  return [
    { date: t, start: '09:00', dur: 10 },
    { date: t, start: '14:00', dur: 10 },
    { date: t, start: '18:00', dur: 10 },
  ];
}
const DEFAULT_CFG = {
  threshold: 30.0,
  hysteresis: 1.0,
  maxDuration: 120,   // detik (mode suhu saja)
  cooldown: 60,       // detik (mode suhu saja)
  mode: 'auto',       // auto | manual
  autoSrc: 'threshold', // threshold | schedule (eksklusif, pilih salah satu)
  schedOn: false,       // turunan dari autoSrc, disimpan untuk kompatibel firmware lama
  // Mode jadwal: daftar semprot bertanggal, tiap slot {date:'YYYY-MM-DD', start:'HH:MM' WIB, dur:menit}.
  // Durasi = lama nyala slot itu. Tanpa cooldown. Maks 6 slot. Yang kedaluwarsa auto-hapus.
  schedules: defaultSchedules(),
};
let __stored = {};
try { __stored = JSON.parse(localStorage.getItem('scs_cfg') || '{}'); } catch { __stored = {}; }
let CFG = { ...DEFAULT_CFG, ...__stored };
// Migrasi: format lama (schedOn/schedStart/schedDur atau slot tanpa tanggal) -> slot bertanggal hari ini.
if (!CFG.autoSrc) CFG.autoSrc = CFG.schedOn ? 'schedule' : 'threshold';
CFG.schedOn = CFG.autoSrc === 'schedule';
try {
  const t = todayWIB(), now = Date.now();
  let slots = SCS.prunePastSlots(SCS.schedulesOf(CFG, t), now); // autoreset: buang yang sudah lewat
  if (slots.length) CFG.schedules = slots;
  else if (!('schedules' in __stored)) CFG.schedules = defaultSchedules(); // pertama kali: contoh 3 slot
  else CFG.schedules = []; // user mengosongkan / semua kedaluwarsa -> boleh kosong
} catch {
  if (!Array.isArray(CFG.schedules)) CFG.schedules = [];
}
delete CFG.schedStart; delete CFG.schedDur;

function saveCfg(){ localStorage.setItem('scs_cfg', JSON.stringify(CFG)); }
