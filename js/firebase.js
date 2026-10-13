// Firebase bridge: autentikasi pengguna, satu writer telemetry (ESP kanan).
import { initializeApp, getApps } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import { getDatabase, ref, onValue, update, push, query, orderByChild, limitToLast, serverTimestamp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-database.js';
import { getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';

let db, auth, callbacks = {}, unsubs = [], timeOffset = 0;
const base = () => `devices/${window.FIREBASE_CONFIG?.deviceId || 'cow-sprinkler-01'}`;
function stopListeners() { unsubs.forEach((fn) => fn()); unsubs = []; }
function listen() {
  stopListeners();
  const failed = () => callbacks.onStatus?.('Akses data ditolak. Periksa akun/rules Firebase.', 'err');
  unsubs.push(onValue(ref(db, '.info/serverTimeOffset'), (snap) => { timeOffset = snap.val() || 0; }));
  unsubs.push(onValue(ref(db, '.info/connected'), (snap) => callbacks.onTransport?.(snap.val() === true)));
  unsubs.push(onValue(ref(db, base() + '/telemetry/latest'), (snap) => callbacks.onTelemetry?.(snap.val()), failed));
  unsubs.push(onValue(ref(db, base() + '/control'), (snap) => callbacks.onControl?.(snap.val()), failed));
  unsubs.push(onValue(query(ref(db, base() + '/events'), orderByChild('ts'), limitToLast(50)), (snap) => {
    const rows = [];
    snap.forEach((child) => {
      const event = child.val();
      if (event && typeof event.ts === 'number') rows.push({ t: event.ts, msg: String(event.reason || event.type || 'Event perangkat') });
    });
    callbacks.onEvents?.(rows.reverse());
  }, failed));
  unsubs.push(onValue(query(ref(db, base() + '/telemetry/log'), orderByChild('ts'), limitToLast(120)), (snap) => {
    const rows = [];
    snap.forEach((child) => { const raw = child.val(); if (raw && typeof raw.ts === 'number') rows.push(SCSTelemetry.logRow(raw)); });
    callbacks.onSeedLogs?.(rows.reverse());
  }, failed));
}
async function connect(handlers) {
  callbacks = handlers;
  if (auth) return;
  const c = window.FIREBASE_CONFIG;
  if (!c?.apiKey || !c?.databaseURL) throw new Error('Konfigurasi Firebase publik belum lengkap.');
  const app = getApps()[0] || initializeApp(c);
  db = getDatabase(app);
  auth = getAuth(app);
  onAuthStateChanged(auth, (user) => {
    callbacks.onAuth?.(!!user, user?.email || '');
    if (user) listen();
    else { stopListeners(); callbacks.onTelemetry?.(null); }
  }, (error) => callbacks.onAuthError?.(error));
}
async function login(email, password) {
  if (!auth) throw new Error('Firebase belum siap.');
  return signInWithEmailAndPassword(auth, email, password);
}
function needDb() { if (!auth?.currentUser) throw new Error('Login terlebih dahulu.'); }
function pushControl(obj) {
  needDb();
  return update(ref(db, base() + '/control'), { ...obj, updatedAt: serverTimestamp(), updatedBy: 'web' });
}
async function pushOverride(on, reason) {
  await pushControl({ manualSsr: on ? 'on' : 'off' });
  return pushEvent(reason || (on ? 'Manual ON diminta' : 'Manual OFF diminta'));
}
function pushEvent(msg) {
  needDb();
  return push(ref(db, base() + '/events'), { type: 'web', reason: msg, ts: serverTimestamp() });
}
window.SCSFirebase = { connect, login, logout: () => signOut(auth), pushControl, pushOverride, pushEvent,
  now: () => Date.now() + timeOffset };
