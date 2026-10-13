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
  assert.match(html, /id="loginEmail"[^>]*type="email"[^>]*autocomplete="username"/);
  assert.match(html, /id="loginPassword"[^>]*type="password"[^>]*autocomplete="current-password"/);
});

test('redesigned page has unique IDs and retains core control elements', () => {
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
  assert.equal(ids.length, new Set(ids).size);
  for (const id of ['sensorGrid', 'humidityGrid', 'thiValue', 'chartMetric', 'basisTemperature',
    'basisThi', 'srcThreshold', 'srcSchedule', 'schedList', 'btnSaveCfg', 'btnSprayOn', 'btnSprayOff',
    'greetingName', 'accountName', 'accountAvatar']) {
    assert.ok(ids.includes(id), `missing control: ${id}`);
  }
});

test('local illustration is self-contained and contains no script or remote resource', () => {
  const svg = fs.readFileSync(path.join(root, 'assets/farm-scene.svg'), 'utf8');
  assert.match(svg, /<svg /);
  assert.doesNotMatch(svg, /<script\b|<foreignObject\b|(?:href|src)\s*=\s*["']https?:/i);
  assert.match(html, /src="assets\/farm-scene.svg"/);
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
  assert.equal((await fetch(origin + '/js/app.js?v=36')).status, 200);
  const head = await fetch(origin + '/index.html', { method: 'HEAD' });
  assert.equal(head.status, 200); assert.equal(await head.text(), '');
  for (const name of ['/.git/config', '/js/firebase-config.js', '/database.rules.json',
    '/firmware/smart-cow-sprinkler-firebase/espkanan_FINAL/espkanan_FINAL.ino', '/docs/UI-PREVIEW.md']) {
    assert.equal((await fetch(origin + name)).status, 404, name);
  }
  assert.equal((await fetch(origin, { method: 'POST', body: 'not a write endpoint' })).status, 405);
});
