// Bridge Firebase (ES module). Diimpor via <script type="module"> di index.html.
// SDK modular gstatic 12.19.0, sesuai riset docs/firebase-research.md.
// Mengekspos window.SCSFirebase agar skrip klasik app.js bisa memakai.
import { initializeApp, getApps } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import { getDatabase, ref, onValue, off, set, update, push, query, orderByChild, limitToLast, get, serverTimestamp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-database.js';
import { getAuth, signInWithEmailAndPassword } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';

let db = null, unsubs = [], authed = false;
const dev = () => (window.FIREBASE_CONFIG && window.FIREBASE_CONFIG.deviceId) || 'cow-sprinkler-01';
const base = () => `devices/${dev()}`;

function cfgOk() {
  const c = window.FIREBASE_CONFIG || {};
  return c.apiKey && c.databaseURL && c.email && c.password;
}

async function connect({ onStatus, onTelemetry, onSeedLogs }) {
  if (!cfgOk()) throw new Error('isi dulu js/firebase-config.js (lihat firebase-config.example)');
  if (!db) {
    const c = window.FIREBASE_CONFIG;
    const app = getApps().length ? getApps()[0] : initializeApp({ apiKey: c.apiKey, authDomain: c.authDomain, databaseURL: c.databaseURL, projectId: c.projectId });
    onStatus && onStatus('Login akun demo…', 'sim');
    await signInWithEmailAndPassword(getAuth(app), c.email, c.password);
    authed = true;
    db = getDatabase(app);
  }
  onStatus && onStatus('Terhubung! Menunggu telemetri ESP32 di ' + base() + '/telemetry/latest', 'live');
  const latestRef = ref(db, base() + '/telemetry/latest');
  const cb = (snap) => {
    const v = snap.val();
    if (!v) { onStatus && onStatus('Terhubung, tapi ESP32 belum kirim data. Cek firmware + WiFi.', 'live'); return; }
    onTelemetry && onTelemetry({ s: [v.t1, v.t2, v.t3, v.t4, v.t5, v.t6], avg: v.avg, ssr: v.ssr, sched: v.sched, n: v.n });
  };
  onValue(latestRef, cb);
  unsubs.push(() => off(latestRef, 'value', cb));
  try {
    const q = query(ref(db, base() + '/telemetry/log'), orderByChild('ts'), limitToLast(120));
    const snap = await get(q);
    const rows = [];
    snap.forEach((ch) => {
      const v = ch.val();
      rows.push({ t: v.ts, s: [v.t1, v.t2, v.t3, v.t4, v.t5, v.t6], avg: v.avg, spray: v.ssr ? 1 : 0 });
    });
    onSeedLogs && onSeedLogs(rows.reverse());
  } catch (e) { /* log lama opsional, abaikan */ }
  return true;
}

function disconnect() { unsubs.forEach((u) => { try { u(); } catch {} }); unsubs = []; }
function needDb() { if (!db || !authed) throw new Error('Firebase belum terhubung'); }

function pushControl(obj) {
  needDb();
  return update(ref(db, base() + '/control'), { ...obj, updatedAt: serverTimestamp(), updatedBy: 'web' });
}
function pushOverride(on, reason) {
  needDb();
  update(ref(db, base() + '/control'), { manualSsr: on ? 'on' : 'off', updatedAt: serverTimestamp(), updatedBy: 'web' });
  return push(ref(db, base() + '/events'), { type: on ? 'manual_on' : 'manual_off', reason: reason || '', ts: serverTimestamp() });
}
function pushLog(row) {
  needDb();
  return push(ref(db, base() + '/telemetry/log'), { t1: row.s[0], t2: row.s[1], t3: row.s[2], t4: row.s[3], t5: row.s[4], t6: row.s[5], avg: row.avg, ssr: row.spray ? 1 : 0, ts: row.t });
}
function pushEvent(msg) {
  needDb();
  return push(ref(db, base() + '/events'), { type: 'web', reason: msg, ts: serverTimestamp() });
}

window.SCSFirebase = { connect, disconnect, pushControl, pushOverride, pushLog, pushEvent };
