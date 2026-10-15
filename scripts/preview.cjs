// Local-only preview. Serve web assets, never firmware, .git, or local secrets.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const assets = new Set(['index.html', 'css/style.css', 'assets/farm-scene.svg',
  'js/core.js', 'js/control.js', 'js/telemetry.js', 'js/config.js',
  'js/firebase-public.js', 'js/firebase.js', 'js/app.js', 'js/access.js', 'js/admin.js']);
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml' };
const port = Number(process.env.PORT || 8765);
const server = http.createServer((req, res) => {
  if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); res.end(); return; }
  let asset;
  try { asset = new URL(req.url, 'http://localhost').pathname.slice(1) || 'index.html'; }
  catch { res.writeHead(400); res.end(); return; }
  if (!assets.has(asset)) { res.writeHead(404); res.end('Not found'); return; }
  fs.readFile(path.join(root, asset), (error, data) => {
    if (error) { res.writeHead(500); res.end('Asset unavailable'); return; }
    res.writeHead(200, { 'Content-Type': `${types[path.extname(asset)]}; charset=utf-8`,
      'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "frame-ancestors 'none'" });
    res.end(req.method === 'HEAD' ? undefined : data);
  });
});
server.on('error', error => { console.error(`Preview gagal: ${error.message}`); process.exitCode = 1; });
server.listen(port, '127.0.0.1', () => {
  console.log(`SmartCow LOCAL preview: http://127.0.0.1:${server.address().port}`);
  console.log('Tidak deploy/push. Firebase tetap backend asli; tombol kontrol setelah login mengubah perangkat asli.');
  console.log('Hentikan dengan Ctrl+C.');
});
