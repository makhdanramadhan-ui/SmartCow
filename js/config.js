// Konfigurasi default — bisa diubah dari UI, tersimpan di localStorage.
// Sumber data tunggal: Firebase (ESP32 menulis, web membaca + kirim perintah).
const DEFAULT_CFG = {
  threshold: 30.0,
  hysteresis: 1.0,
  maxDuration: 120,   // detik
  cooldown: 60,       // detik
  mode: 'auto',       // auto | manual
  schedOn: false,
  schedStart: '12:00', // WIB HH:MM
  schedDur: 10         // menit
};
let CFG = { ...DEFAULT_CFG, ...(JSON.parse(localStorage.getItem('scs_cfg') || '{}')) };

function saveCfg(){ localStorage.setItem('scs_cfg', JSON.stringify(CFG)); }
