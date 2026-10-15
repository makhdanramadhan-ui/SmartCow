const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

test('unauthenticated HTML fails closed without waiting for JavaScript', () => {
  const shell = html.match(/<div\b[^>]*id="appShell"[^>]*>/)?.[0];
  assert.ok(shell);
  assert.match(shell, /\bhidden\b/);
  assert.match(shell, /\binert\b/);
  assert.match(html, /<main\b[^>]*id="authPanel"/);
  const login = html.match(/<main\b[^>]*id="authPanel"[^>]*>/)?.[0];
  assert.match(login, /\bhidden\b/);
  assert.match(login, /\binert\b/);
  assert.match(html, /id="sessionPanel"[^>]*role="status"[^>]*aria-live="polite"[^>]*aria-busy="true"/);
  assert.match(html, /id="loginEmail"[^>]*type="email"[^>]*autocomplete="username"/);
  assert.match(html, /id="loginPassword"[^>]*type="password"[^>]*autocomplete="current-password"/);
});

test('session restoration waits for Firebase rather than a local login flag', () => {
  const app = fs.readFileSync(path.join(root, 'js/app.js'), 'utf8');
  const firebase = fs.readFileSync(path.join(root, 'js/firebase.js'), 'utf8');
  assert.match(app, /function setAuthView\(ok, email=''\)\{\s*authResolved=true;/);
  assert.match(app, /\$\('sessionPanel'\)\.hidden=true/);
  assert.match(app, /\$\('authPanel'\)\.inert=ok/);
  assert.match(app, /onAuth: \(ok, email\)=>\{[\s\S]*?setAuthView\(ok, email\)/);
  assert.match(app, /sessionWaitTimer=setTimeout\(sessionFailed,15000\)/);
  assert.match(firebase, /onAuthStateChanged\(auth,/);
  assert.match(firebase, /callbacks\.onAuthError\?\.\(error\)/);
  assert.doesNotMatch(app, /(?:localStorage|sessionStorage)\.(?:getItem|setItem)\(['"](?:loggedIn|authenticated|scs_auth)/);
});

test('redesigned page has unique IDs and retains core control elements', () => {
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
  assert.equal(ids.length, new Set(ids).size);
  for (const id of ['sensorGrid', 'humidityGrid', 'thiValue', 'chartMetric', 'basisTemperature',
    'basisThi', 'srcThreshold', 'srcSchedule', 'schedList', 'btnSaveCfg', 'btnSprayOn', 'btnSprayOff',
    'greetingName', 'accountName', 'accountAvatar', 'sensorDialog', 'btnCloseSensors',
    'btnTemperatureDetails', 'btnHumidityDetails', 'menuBtn', 'sideClose']) {
    assert.ok(ids.includes(id), `missing control: ${id}`);
  }
});

test('overview puts relay and mode before climate summaries and keeps sensor grids inside a closed dialog', () => {
  assert.ok(html.indexOf('class="grid command-grid"') < html.indexOf('class="grid summary-grid"'));
  const dialog = html.match(/<dialog\b[^>]*id="sensorDialog"[^>]*>([\s\S]*?)<\/dialog>/);
  assert.ok(dialog);
  assert.doesNotMatch(dialog[0].split('>')[0], /\bopen\b/);
  assert.match(dialog[1], /id="sensorGrid"/);
  assert.match(dialog[1], /id="humidityGrid"/);
  assert.match(dialog[1], /data-sensor-panel="temperature" hidden/);
  assert.match(dialog[1], /data-sensor-panel="humidity" hidden/);
  const main = html.match(/<main\b[^>]*id="mainContent"[^>]*>([\s\S]*?)<\/main>/)?.[1];
  assert.ok(main);
  assert.doesNotMatch(main, /id="(?:sensorGrid|humidityGrid)"/);
  assert.match(main, /id="btnTemperatureDetails"[^>]*data-sensors="temperature"[^>]*aria-haspopup="dialog"/);
  assert.match(main, /id="btnHumidityDetails"[^>]*data-sensors="humidity"[^>]*aria-haspopup="dialog"/);
  assert.doesNotMatch(main, /href="#sensorSection"/);
});

test('sidebar starts closed and inert, with an accessible toggle', () => {
  assert.match(html, /<aside\b[^>]*id="sidebar"[^>]*aria-hidden="true"[^>]*\binert\b/);
  assert.match(html, /id="menuBtn"[^>]*aria-controls="sidebar"[^>]*aria-expanded="false"/);
});

test('overview welcomes the signed-in account without changing the dynamic greeting or barn banner', () => {
  const heading = html.match(/<section class="page-heading" data-page="dash">([\s\S]*?)<\/section>/)?.[1];
  assert.ok(heading);
  assert.match(heading, /<h1>Halo, <span id="greetingName">Pengelola<\/span>\.<\/h1>/);
  assert.match(heading, /<p>Selamat datang di SmartCow\. Pantau kondisi Kandang A dalam satu tempat\.<\/p>/);
  assert.match(heading, /id="clock"/);
  assert.match(html, /<div class="hero-copy"><h2>Kandang A<\/h2><\/div>/);
});

test('threshold summaries start hidden with no hard-coded default values', () => {
  assert.match(html, /<div data-threshold-basis="temperature" hidden>Ambang suhu <b id="thresholdLabel">—<\/b>/);
  assert.match(html, /<div class="mini-stats" data-threshold-basis="thi" hidden><div>Ambang THI <b id="thiThresholdLabel">—<\/b>/);
});

test('local illustration is self-contained and contains no script or remote resource', () => {
  const svg = fs.readFileSync(path.join(root, 'assets/farm-scene.svg'), 'utf8');
  assert.match(svg, /<svg /);
  assert.doesNotMatch(svg, /<script\b|<foreignObject\b|(?:href|src)\s*=\s*["']https?:/i);
  assert.match(html, /src="assets\/farm-scene.svg\?v=42"/);
});

test('Barn Console keeps depth selective, snapshot labels explicit and release assets versioned', () => {
  const css = fs.readFileSync(path.join(root, 'css/style.css'), 'utf8');
  assert.match(css, /--shadow:[^;]*, -9px -9px/);
  assert.match(css, /--inset: inset/);
  assert.match(css, /:focus-visible\s*\{\s*outline: 3px solid/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(html, /Titik terendah/);
  assert.match(html, /Titik tertinggi/);
  assert.match(html, /Min\/maks antar titik · pembacaan terkini/);
  assert.doesNotMatch(html, /Kenali iklimnya|MINDFUL CARE|greeting-leaf/);
  const hero = html.match(/<section class="farm-hero"[\s\S]*?<\/section>/)?.[0];
  assert.match(hero, /Kandang A/);
  assert.doesNotMatch(hero,/SISTEM \/ 01|ESP32|relay|Lihat titik sensor|hero-kicker/);
  assert.doesNotMatch(hero, /id="heroHealth"|data-sensors=/);
  for (const url of [...html.matchAll(/(?:src|href)="((?:js|css)\/[^\"]+)"/g)].map(m => m[1])) {
    const version = /^(?:css\/|js\/admin\.js)/.test(url) ? 45 : /^js\/(?:access|firebase)\.js/.test(url) ? 44 : 42;
    assert.ok(url.endsWith(`?v=${version}`), `unexpected asset version: ${url}`);
  }
});

test('Admin has a separate directory, labelled account fields and accessible permission cards', () => {
  assert.match(html, /class="page-heading admin-heading" data-page="admin" hidden/);
  assert.match(html, /id="adminStatus"[^>]*data-page="admin"[^>]*role="status"/);
  assert.match(html, /class="card admin-create" aria-labelledby="createUserTitle"/);
  assert.match(html, /class="card admin-directory" aria-labelledby="userListTitle"/);
  for (const id of ['newUserName', 'newUserEmail', 'newUserPassword']) {
    assert.match(html, new RegExp(`<label for="${id}">`));
  }
  assert.match(html, /id="newUserPassword"[^>]*aria-describedby="newPasswordHint"/);
  assert.equal((html.match(/class="permission-choice"/g) || []).length, 3);
  for (const name of ['Monitoring', 'Pengaturan', 'Operasi sprinkler']) {
    assert.ok(html.includes(`aria-label="${name}"`));
  }
  assert.match(html, /id="userCount"/);
  const css = fs.readFileSync(path.join(root, 'css/style.css'), 'utf8');
  assert.match(css, /container: admin-directory \/ inline-size/);
  assert.match(css, /@container admin-directory \(min-width: 580px\)/);
  assert.match(css, /\.permission-choice input:checked::before/);
  assert.match(css, /\.permission-choice input, \.access-toggle input \{ appearance: auto/);
});

test('account role, collapsed actions, access-only deletion and theme-specific sprinkler are explicit', () => {
  assert.match(html, /id="userListTitle"[^>]*>Daftar Akun:<\/h3>/);
  for (const role of ['user', 'admin']) assert.match(html, new RegExp(`name="newAccountRole" value="${role}"`));
  assert.match(html, /id="deleteUserDialog"[^>]*aria-describedby="deleteUserDescription"/);
  assert.match(html, /Identitas Firebase Auth tetap ada/);
  const admin = fs.readFileSync(path.join(root, 'js/admin.js'), 'utf8');
  const firebase = fs.readFileSync(path.join(root, 'js/firebase.js'), 'utf8');
  assert.match(admin, /panel\.hidden=!expanded\.has\(user\.uid\)/);
  assert.match(admin, /setAttribute\('aria-expanded'/);
  assert.match(admin, /SCSFirebase\.removeUserAccess\(user\.uid\)/);
  assert.doesNotMatch(admin + html + firebase, /Kirim email reset|sendPasswordResetEmail|resetPassword/);
  const css = fs.readFileSync(path.join(root, 'css/style.css'), 'utf8');
  assert.match(css, /:root\[data-theme="dark"\] \.sprinkler-card \{ --card: #2b3545/);
  assert.match(css, /\.sprinkler-card \{ color: var\(--txt\); \}/);
});

test('current account has a read-only card above the account directory in the same column', () => {
  const column = html.match(/<div class="admin-accounts">([\s\S]*?)<\/article>\s*<\/div>/)?.[1];
  assert.ok(column);
  assert.match(column, /class="card current-account" aria-labelledby="currentAccountTitle"/);
  assert.match(column, /id="currentAccountTitle">Akun saat ini:<\/h3>/);
  assert.ok(column.indexOf('id="currentAccountTitle"') < column.indexOf('id="userListTitle"'));
  const card = column.slice(0, column.indexOf('</article>'));
  for (const field of ['Name', 'Email', 'Avatar', 'Role', 'State']) assert.ok(card.includes(`id="currentAccount${field}"`));
  assert.doesNotMatch(card, /<button|<input|<form/);
  const admin = fs.readFileSync(path.join(root, 'js/admin.js'), 'utf8');
  assert.match(admin, /const account=allowed\(\)\?window\.smartcowAccess:null/);
  assert.match(admin, /syncCurrentAccount\(\);/);
});

test('configuration precedes a full-width chart with three labelled responsive control groups', () => {
  const insights = html.slice(html.indexOf('<section class="grid insights-grid"'), html.indexOf('<section class="page-heading" data-page="log"'));
  assert.ok(insights.indexOf('class="card control-card"') < insights.indexOf('class="card chart-card"'));
  assert.doesNotMatch(insights, /grid-2/);
  assert.equal((insights.match(/class="control-section(?: protection-section)?"/g) || []).length, 3);
  for (const id of ['basisTitle', 'sourceTitle', 'protectionTitle']) {
    assert.match(insights, new RegExp(`aria-labelledby="${id}"`));
    assert.match(insights, new RegExp(`<h4 id="${id}">`));
  }
  assert.match(insights, /class="control-actions"[\s\S]*id="btnSaveCfg"/);
  const css = fs.readFileSync(path.join(root, 'css/style.css'), 'utf8');
  assert.match(css, /\.insights-grid\s*\{\s*grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(css, /container: sprinkler-config \/ inline-size/);
  assert.match(css, /@container sprinkler-config \(min-width: 680px\)/);
  assert.match(css, /@container sprinkler-config \(min-width: 1000px\)/);
  assert.match(css, /\.control-card #schedList\s*\{\s*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(css, /--radius: 14px/);
});

test('preview HTTP server serves only runtime assets and refuses writes/private paths', async t => {
  const child = spawn(process.execPath, ['scripts/preview.cjs'], {
    cwd: root, env: { ...process.env, PORT: '0' }, stdio: ['ignore', 'pipe', 'pipe']
  });
  t.after(() => child.kill());
  const origin = await new Promise((resolve, reject) => {
    let out = '';
    const timer = setTimeout(() => reject(new Error('Preview startup timed out')), 5000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`Preview exited: ${code}`)); });
    child.stdout.on('data', data => {
      out += data;
      const match = out.match(/http:\/\/127\.0\.0\.1:(\d+)/);
      if (match) { clearTimeout(timer); resolve(match[0]); }
    });
  });
  const page = await fetch(origin);
  assert.equal(page.status, 200);
  assert.equal(page.headers.get('cache-control'), 'no-store');
  assert.match(await page.text(), /id="appShell" class="app-shell" hidden inert/);
  assert.equal((await fetch(origin + '/assets/farm-scene.svg')).status, 200);
  assert.equal((await fetch(origin + '/js/app.js?v=42')).status, 200);
  const head = await fetch(origin + '/index.html', { method: 'HEAD' });
  assert.equal(head.status, 200); assert.equal(await head.text(), '');
  for (const name of ['/.git/config', '/js/firebase-config.js', '/database.rules.json',
    '/firmware/smart-cow-sprinkler-firebase/espkanan_FINAL/espkanan_FINAL.ino', '/docs/UI-PREVIEW.md']) {
    assert.equal((await fetch(origin + name)).status, 404, name);
  }
  assert.equal((await fetch(origin, { method: 'POST', body: 'not a write endpoint' })).status, 405);
});
