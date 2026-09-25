/* Smart Cow Sprinkler — app logic (simulation-first + Firebase live) */
const $ = (id) => document.getElementById(id);
const SENSOR_NAMES = ['Titik 1 • Depan', 'Titik 2 • Depan', 'Titik 3 • Tengah', 'Titik 4 • Tengah', 'Titik 5 • Belakang', 'Titik 6 • Belakang'];
const COLORS = ['#e11d48','#ea580c','#a16207','#15803d','#2563eb','#7c3aed'];
const AVG_COLOR = '#0e7490';

let temps = []; // snapshot terakhir; dihasilkan adapter sim atau live
let lastUpdate = null;
let sprinklerOn = false;
let sprayStart = null;
let lastSprayEnd = 0;
let expPushed = false; // cegah perintah durasi-maks ganda tiap detik
let history = [];   // {t, s:[6], avg} tiap 2 detik, maks 1800 (1 jam)
let logs = JSON.parse(localStorage.getItem('scs_logs') || '[]'); // tiap 30 detik, maks 120
let events = JSON.parse(localStorage.getItem('scs_events') || '[]');
let fbConnected = false;
let sensorCount = null;
let lastLogTime = 0;

try { history = JSON.parse(localStorage.getItem('scs_hist') || '[]'); } catch { history = []; }
if (!Array.isArray(history)) history = [];
history = history.slice(-1800);

// ---------- WIB CLOCK ----------
function tickClock(){
  const now = new Date();
  const fmt = new Intl.DateTimeFormat('id-ID',{timeZone:'Asia/Jakarta',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false});
  const fmtD = new Intl.DateTimeFormat('id-ID',{timeZone:'Asia/Jakarta',weekday:'long',day:'numeric',month:'long',year:'numeric'});
  $('clock').textContent = fmt.format(now).replace(/\./g,':');
  $('dateLine').textContent = fmtD.format(now);
}
setInterval(tickClock, 1000); tickClock();

// ---------- SENSOR GRID (jumlah kartu ikut sensor terdeteksi) ----------
let renderedCount = 6;
function buildGrid(count){
  renderedCount = count;
  const g = $('sensorGrid'); g.innerHTML = '';
  g.style.display = count === 0 ? 'none' : '';
  $('noSensor').style.display = count === 0 ? 'block' : 'none';
  for (let i = 0; i < count; i++){
    const d = document.createElement('div');
    d.className = 'sensor'; d.id = 'sensor'+i;
    d.innerHTML = `<div class="s-name">S${i+1} • ${SENSOR_NAMES[i]}</div>
      <div class="s-temp">--.-°</div>
      <div class="bar"><i></i></div>
      <div class="s-state ok">OK</div>`;
    g.appendChild(d);
  }
  const leg = $('legend'); leg.innerHTML = '';
  for (let i = 0; i < count; i++){
    const s = document.createElement('span');
    s.innerHTML = `<i style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${COLORS[i]}"></i> S${i+1}`;
    leg.appendChild(s);
  }
}
function buildLogHead(count){
  const tr = $('logHead'); if (!tr) return;
  let h = '<th>Waktu (WIB)</th>';
  for (let i = 1; i <= count; i++) h += `<th>S${i}</th>`;
  h += '<th>Rata²</th><th>Status</th><th>Sprinkler</th>';
  tr.innerHTML = h;
}
function tempColor(t){
  if (t >= CFG.threshold + 1) return '#dc2626';
  if (t >= CFG.threshold) return '#b45309';
  if (t >= CFG.threshold - 1) return '#15803d';
  return '#2563eb';
}
function renderSensors(){
  const shown = temps.slice(0, renderedCount);
  let mn = 99, mx = -99;
  shown.forEach((t,i)=>{
    mn = Math.min(mn,t); mx = Math.max(mx,t);
    const el = $('sensor'+i); if(!el) return;
    el.querySelector('.s-temp').textContent = t.toFixed(1)+'°';
    el.querySelector('.s-temp').style.color = tempColor(t);
    const pct = Math.min(1, Math.max(0.04, (t-25)/(38-25)));
    const bar = el.querySelector('.bar i');
    bar.style.transform = `scaleX(${pct})`; bar.style.background = tempColor(t);
    const st = el.querySelector('.s-state');
    if (t >= CFG.threshold){ st.textContent = 'PANAS'; st.className = 's-state hot'; }
    else if (t >= CFG.threshold - CFG.hysteresis){ st.textContent = 'WASPADA'; st.className = 's-state warn'; }
    else { st.textContent = 'NORMAL'; st.className = 's-state ok'; }
  });
  const avg = SCS.avgOf(shown);
  const pill = $('avgStatus');
  if (!isFinite(avg)){ // Q2: avgOf tetap murni; tampilan yang menjaga
    $('avgTemp').textContent = '--'; $('minTemp').textContent = '--'; $('maxTemp').textContent = '--';
    pill.textContent = 'TIDAK ADA DATA'; pill.className = 'status-pill normal';
    $('logicPreview').textContent = 'Menunggu data titik suhu yang valid.';
    return NaN;
  }
  $('avgTemp').textContent = avg.toFixed(1);
  $('minTemp').textContent = mn.toFixed(1)+'°C';
  $('maxTemp').textContent = mx.toFixed(1)+'°C';
  $('thresholdLabel').textContent = CFG.threshold.toFixed(1)+'°C';
  if (avg >= CFG.threshold + 1){ pill.textContent='STRESS PANAS: SEMPROT!'; pill.className='status-pill bahaya'; }
  else if (avg >= CFG.threshold){ pill.textContent='WASPADA: THRESHOLD TERSENTUH'; pill.className='status-pill waspada'; }
  else { pill.textContent='NORMAL: SAPI NYAMAN'; pill.className='status-pill normal'; }
  $('logicPreview').textContent = `Saat ini: avg ${avg.toFixed(1)}°C vs ON ≥ ${CFG.threshold.toFixed(1)}°C / OFF ≤ ${(CFG.threshold-CFG.hysteresis).toFixed(1)}°C`;
  if (lastUpdate) $('updateAge').textContent = 'update: ' + new Date(lastUpdate).toLocaleTimeString('id-ID',{timeZone:'Asia/Jakarta'}) + ' WIB';
  return avg;
}

// ---------- SPRINKLER (perintah manual ke ESP32 via Firebase) ----------
function setSprinkler(on, reason){
  const r = SCSSource.command(on, reason);
  if (r === 'sent'){ $('sprinklerReason').textContent = 'Perintah dikirim, menunggu ESP32 mengeksekusi…'; return; }
  if (r === 'local' && CFG.mode === 'manual'){ // simulasi: override langsung berlaku
    sprinklerOn = on; sprayStart = on ? Date.now() : null; if (!on) lastSprayEnd = Date.now(); else expPushed = false;
    pushEvent(`Simulasi: Override manual ${on ? 'ON' : 'OFF'} (${reason})`); renderSprinkler(); return;
  }
  $('sprinklerReason').textContent = r === 'local' ? 'Simulasi lokal: relay hanya lewat mode manual.' : 'Firebase belum terhubung.';
}
function renderSprinkler(){
  const box = $('sprinklerState');
  box.className = 'sprinkler ' + (sprinklerOn ? 'on' : 'off');
  $('sprinklerText').textContent = sprinklerOn ? 'MENYEMPROT' : 'MATI';
  if (sprinklerOn && sprayStart){
    const el = Math.floor((Date.now()-sprayStart)/1000);
    const left = CFG.maxDuration - el;
    $('sprinklerTimer').textContent = `Jalan ${el} dtk · auto-off dalam ${Math.max(0,left)} dtk`;
    if (left <= 0 && !expPushed){
      expPushed = true;
      if (SCSSource.command(false, `durasi maks ${CFG.maxDuration} dtk tercapai (proteksi air)`) === 'sent') return;
      if (SCSSource.isLive()){ $('sprinklerReason').textContent = 'Firebase belum terhubung.'; return; }
      sprinklerOn = false; sprayStart = null; lastSprayEnd = Date.now();
      pushEvent(`Simulasi: Sprinkler OFF (durasi maks ${CFG.maxDuration} dtk, proteksi air)`); renderSprinkler();
    }
  } else {
    $('sprinklerTimer').textContent = CFG.mode==='manual' ? 'Mode manual: gunakan tombol.' : 'Mode otomatis: menunggu ambang.';
  }
}
setInterval(renderSprinkler, 1000);

function autoControl(avg){
  // Relay fisik milik ESP32 saat live; web hanya mirror + rekomendasi.
  // Saat sim, kebijakan penuh SCS.decideRelay berlaku lokal.
  if (CFG.mode !== 'auto') return;
  if (SCSSource.isLive()){
    if (fbConnected){
      if (avg >= CFG.threshold && !sprinklerOn) $('sprinklerReason').textContent = `Rekomendasi: NYALA (avg ${avg.toFixed(1)} ≥ ${CFG.threshold.toFixed(1)}°C). ESP mengeksekusi.`;
      else if (avg <= CFG.threshold - CFG.hysteresis && sprinklerOn) $('sprinklerReason').textContent = 'Rekomendasi: MATI.';
    }
    return;
  }
  const sched = CFG.schedOn && SCS.scheduleActive(wibMinutes(), SCS.hmToMin(CFG.schedStart), CFG.schedDur);
  const res = SCS.decideRelay(avg, { on: sprinklerOn, sprayStart, lastSprayEnd }, CFG, Date.now(), sched);
  if (res.action === 'on' && !sprinklerOn){
    sprinklerOn = true; sprayStart = Date.now(); expPushed = false;
    pushEvent(`Simulasi: Sprinkler ON (avg ${avg.toFixed(1)}°C, ${res.reason})`);
    $('sprinklerReason').textContent = 'Simulasi lokal: relay ON.'; renderSprinkler();
  }
  else if (res.action === 'off' && sprinklerOn){
    sprinklerOn = false; sprayStart = null; lastSprayEnd = Date.now();
    pushEvent(`Simulasi: Sprinkler OFF (${res.reason})`);
    $('sprinklerReason').textContent = 'Simulasi lokal: relay OFF.'; renderSprinkler();
  }
  else if (!sprinklerOn) $('sprinklerReason').textContent = `Standby: avg ${avg.toFixed(1)}°C < ${CFG.threshold.toFixed(1)}°C`;
}

// ---------- DATA MASUK (dari Firebase via ESP32) ----------
function onNewData(arr){
  temps = arr.slice(0,6);
  lastUpdate = Date.now();
  const st = $('sensorTitle'); if (st) st.textContent = SCS.sensorTitle(sensorCount);
  if (renderedCount === 0) return;
  const avg = renderSensors();
  if (!isFinite(avg)) return; // tanpa data valid: tampil saja, jangan catat
  history.push({ t: lastUpdate, s: temps.map(v=>+v.toFixed(2)), avg:+avg.toFixed(2) });
  if (history.length > 1800) history = history.slice(-1800);
  localStorage.setItem('scs_hist', JSON.stringify(history.slice(-600)));
  drawChart();
  autoControl(avg);
  if (Date.now() - lastLogTime > 30000) addLogRow(avg);
}

// ---------- CHART (canvas murni, offline-friendly) ----------
function drawChart(){
  const c = $('chart'), ctx = c.getContext('2d');
  const css = getComputedStyle(document.documentElement);
  const gridColor = css.getPropertyValue('--chart-grid').trim() || '#e2e4e9';
  const inkColor = css.getPropertyValue('--chart-ink').trim() || '#5d6875';
  const W = c.width = c.clientWidth * 2, H = c.height = 440;
  ctx.clearRect(0,0,W,H);
  if (history.length < 2){ ctx.fillStyle=inkColor; ctx.font='28px sans-serif'; ctx.fillText('Menunggu data…', 30, 60); return; }
  const data = history.slice(-720);
  let mn = 99, mx = -99;
  data.forEach(d=>{ d.s.forEach(v=>{mn=Math.min(mn,v);mx=Math.max(mx,v);}); });
  mn = Math.min(mn, CFG.threshold-2)-0.3; mx = Math.max(mx, CFG.threshold+2)+0.3;
  const X = i => 60 + i/(data.length-1)*(W-80);
  const Y = v => 20 + (1-(v-mn)/(mx-mn))*(H-70);
  // grid + threshold
  ctx.strokeStyle=gridColor; ctx.fillStyle=inkColor; ctx.font='22px sans-serif';
  for(let k=0;k<=4;k++){ const v=mn+(mx-mn)*k/4, y=Y(v);
    ctx.beginPath(); ctx.moveTo(60,y); ctx.lineTo(W-20,y); ctx.stroke();
    ctx.fillText(v.toFixed(1)+'°', 4, y+7); }
  const yT = Y(CFG.threshold);
  ctx.setLineDash([12,8]); ctx.strokeStyle='#b45309'; ctx.lineWidth=3;
  ctx.beginPath(); ctx.moveTo(60,yT); ctx.lineTo(W-20,yT); ctx.stroke(); ctx.setLineDash([]);
  ctx.fillStyle='#b45309'; ctx.fillText('threshold '+CFG.threshold.toFixed(1)+'°', 70, yT-10);
  const draw = (idx, color, get) => {
    ctx.strokeStyle=color; ctx.lineWidth = idx==='avg'?5:2.5; ctx.beginPath();
    data.forEach((d,i)=>{ const y=Y(get(d)); i?ctx.lineTo(X(i),y):ctx.moveTo(X(i),y); });
    ctx.stroke();
  };
  for(let s=0;s<renderedCount;s++) draw(s, COLORS[s]+'cc', d=>d.s[s]);
  if ($('showAvg').checked) draw('avg', AVG_COLOR, d=>d.avg);
}
window.addEventListener('resize', drawChart);
$('showAvg').onchange = drawChart;
$('btnClearChart').onclick = ()=>{ history=[]; localStorage.removeItem('scs_hist'); drawChart(); };

// ---------- LOG 1 JAM ----------
function addLogRow(avg){
  if (!isFinite(avg)) return;
  lastLogTime = Date.now();
  const row = { t: lastLogTime, s: temps.map(v=>+v.toFixed(1)), avg:+avg.toFixed(1), spray: sprinklerOn?1:0 };
  logs.unshift(row); logs = logs.slice(0,120);
  localStorage.setItem('scs_logs', JSON.stringify(logs));
  if (fbConnected && window.SCSFirebase) SCSFirebase.pushLog(row);
  renderLogs();
}
function renderLogs(){
  const f = $('filterSensor').value;
  const tb = $('logBody'); tb.innerHTML='';
  const rows = logs.filter(r => f==='all' ? true : f==='panas' ? r.avg>=CFG.threshold : r.avg<CFG.threshold);
  if (!rows.length){ tb.innerHTML = `<tr><td colspan="${4 + renderedCount}" class="empty">Tidak ada baris untuk filter ini.</td></tr>`; }
  rows.forEach(r=>{
    const tr = document.createElement('tr');
    const time = new Date(r.t).toLocaleTimeString('id-ID',{timeZone:'Asia/Jakarta',hour:'2-digit',minute:'2-digit',second:'2-digit'});
    const hot = r.avg >= CFG.threshold;
    tr.innerHTML = `<td>${time}</td>` + r.s.slice(0, renderedCount).map(v=>`<td class="${v>=CFG.threshold?'hot':'cold'}">${v.toFixed(1)}</td>`).join('')
      + `<td><b>${r.avg.toFixed(1)}</b></td><td>${hot?'PANAS':'NORMAL'}</td><td>${r.spray?'ON':'OFF'}</td>`;
    tb.appendChild(tr);
  });
  $('logCount').textContent = `${logs.length}/120 baris (1 jam @30 dtk)`;
}
$('filterSensor').onchange = renderLogs;
$('btnLogNow').onclick = ()=>{ const avg = SCS.avgOf(temps); lastLogTime = 0; addLogRow(avg); };
$('btnClearLog').onclick = ()=>{ if(confirm('Hapus semua log?')){ logs=[]; localStorage.removeItem('scs_logs'); renderLogs(); } };
$('btnExport').onclick = ()=>{
  let csv = 'waktu_wib,' + Array.from({length: renderedCount}, (_,i)=>'s'+(i+1)).join(',') + ',avg,status,sprinkler\n';
  [...logs].reverse().forEach(r=>{
    const w = new Date(r.t).toLocaleString('id-ID',{timeZone:'Asia/Jakarta'});
    csv += `"${w}",${r.s.slice(0, renderedCount).join(',')},${r.avg},${r.avg>=CFG.threshold?'PANAS':'NORMAL'},${r.spray?'ON':'OFF'}\n`;
  });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv],{type:'text/csv'}));
  a.download = 'log-suhu-kandang.csv'; a.click();
};

// ---------- EVENTS ----------
function pushEvent(msg){
  events.unshift({ t: Date.now(), msg }); events = events.slice(0,50);
  localStorage.setItem('scs_events', JSON.stringify(events));
  if (fbConnected && window.SCSFirebase) SCSFirebase.pushEvent(msg);
  renderEvents();
}
function renderEvents(){
  const ul = $('eventList'); ul.innerHTML = events.length?'':'<li class="hint">Belum ada event.</li>';
  events.forEach(e=>{
    const li = document.createElement('li');
    const msg = document.createElement('div'); msg.textContent = e.msg;
    const t = document.createElement('div'); t.className = 't';
    t.textContent = new Date(e.t).toLocaleString('id-ID',{timeZone:'Asia/Jakarta'}) + ' WIB';
    li.append(msg, t); ul.appendChild(li);
  });
}

// ---------- MODE + SOURCE ----------
function syncButtons(){
  $('btnAuto').classList.toggle('active', CFG.mode==='auto');
  $('btnManual').classList.toggle('active', CFG.mode==='manual');
  $('btnSprayOn').disabled = $('btnSprayOff').disabled = CFG.mode!=='manual';
  const locked = CFG.mode !== 'auto';
  ['inThreshold','inHyst','inMaxDur','inCooldown','rangeThreshold','inSchedOn','inSchedStart','inSchedDur','btnSaveCfg'].forEach((id)=>{ $(id).disabled = locked; });
  $('btnSaveCfg').textContent = locked ? 'Terkunci saat mode manual' : 'Simpan Pengaturan';
  $('inThreshold').value = CFG.threshold; $('rangeThreshold').value = CFG.threshold;
  $('inHyst').value = CFG.hysteresis; $('inMaxDur').value = CFG.maxDuration; $('inCooldown').value = CFG.cooldown;
  $('inSchedOn').checked = !!CFG.schedOn; $('inSchedStart').value = CFG.schedStart; $('inSchedDur').value = CFG.schedDur;
  updateSchedHint();
}
$('btnAuto').onclick = ()=>{ CFG.mode='auto'; saveCfg(); syncButtons(); pushEvent('Mode → OTOMATIS'); fbPushControl(); };
$('btnManual').onclick = ()=>{ CFG.mode='manual'; saveCfg(); syncButtons(); pushEvent('Mode → MANUAL'); fbPushControl(); };
$('btnSprayOn').onclick = ()=> setSprinkler(true, 'tombol manual');
$('btnSprayOff').onclick = ()=> setSprinkler(false, 'tombol manual');
function fbPushControl(){
  if (fbConnected && window.SCSFirebase){
    SCSFirebase.pushControl({ mode: CFG.mode, threshold: CFG.threshold, hysteresis: CFG.hysteresis, maxDuration: CFG.maxDuration, cooldown: CFG.cooldown, schedOn: CFG.schedOn ? 1 : 0, schedStart: CFG.schedStart, schedDur: CFG.schedDur });
  }
}
function wibMinutes(){
  const p = new Intl.DateTimeFormat('id-ID',{timeZone:'Asia/Jakarta',hour:'numeric',minute:'numeric',hour12:false}).formatToParts(new Date());
  return (+p.find(x=>x.type==='hour').value) * 60 + (+p.find(x=>x.type==='minute').value);
}
function updateSchedHint(){
  const el = $('schedHint'); if (!el) return;
  if (!CFG.schedOn){ el.textContent = 'Jadwal nonaktif.'; return; }
  const s = SCS.hmToMin(CFG.schedStart), now = wibMinutes();
  if (!isFinite(s)){ el.textContent = 'Format jam salah.'; return; }
  if (SCS.scheduleActive(now, s, CFG.schedDur)) el.textContent = `Jadwal BERJALAN (tiap ${CFG.schedStart}, ${CFG.schedDur} mnt).`;
  else el.textContent = `Jadwal aktif: ${now < s ? 'hari ini' : 'besok'} ${CFG.schedStart} WIB, selama ${CFG.schedDur} mnt.`;
}
// ---------- SUMBER DATA (satu seam: js/source.js) ----------
function sourceHooks(){
  return {
    update: (arr) => onNewData(arr),
    live: (p) => {
      fbConnected = true; setConn('live');
      sensorCount = (typeof p.n === 'number') ? p.n : null;
      const vc = SCS.visibleCount(sensorCount);
      if (vc != null && vc !== renderedCount){ buildGrid(vc); buildLogHead(vc); }
      onNewData(p.s);
      if (typeof p.ssr === 'number' && ((p.ssr === 1) !== sprinklerOn)){
        sprinklerOn = p.ssr === 1; sprayStart = sprinklerOn ? Date.now() : null;
        if (sprinklerOn) expPushed = false; else lastSprayEnd = Date.now();
        pushEvent(sprinklerOn ? (p.sched ? 'ESP32: Sprinkler ON (jadwal)' : 'ESP32: Sprinkler ON') : 'ESP32: Sprinkler OFF');
        renderSprinkler();
      }
    },
    status: (msg, kind) => { $('fbStatus').textContent = msg; setConn(kind); },
    seed: (rows) => { if (rows.length){ logs = SCS.pruneLogs(rows, 120); localStorage.setItem('scs_logs', JSON.stringify(logs)); renderLogs(); } },
    ready: (ok) => { fbConnected = ok; if (ok) fbPushControl(); }
  };
}
function setConn(kind){
  const b = $('connBadge');
  if (kind==='sim'){ b.textContent='● SIMULASI'; b.className='badge sim'; }
  if (kind==='live'){ b.textContent='● LIVE ESP32'; b.className='badge live'; }
  if (kind==='err'){ b.textContent='● KONEKSI GAGAL'; b.className='badge err'; }
}

// ---------- SETTINGS ----------
$('rangeThreshold').oninput = e => { $('inThreshold').value = e.target.value; };
$('inThreshold').oninput = e => { $('rangeThreshold').value = e.target.value; };
$('btnSaveCfg').onclick = ()=>{
  CFG.threshold = Math.min(40, Math.max(25, parseFloat($('inThreshold').value)||30));
  CFG.hysteresis = parseFloat($('inHyst').value)||1;
  CFG.maxDuration = parseInt($('inMaxDur').value)||120;
  CFG.cooldown = parseInt($('inCooldown').value)||60;
  CFG.schedOn = $('inSchedOn').checked;
  CFG.schedStart = $('inSchedStart').value || '12:00';
  CFG.schedDur = Math.min(180, Math.max(1, parseInt($('inSchedDur').value)||10));
  saveCfg(); syncButtons(); renderSensors(); drawChart();
  pushEvent(`Pengaturan disimpan: threshold ${CFG.threshold}°C, hyst ${CFG.hysteresis}°C`);
  fbPushControl();
};

// ---------- TEMA (terang/gelap, ikut sistem + toggle) ----------
function applyTheme(t){
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem('scs_theme', t); } catch {}
  const b = $('btnTheme'); if (b) b.setAttribute('aria-pressed', t === 'dark' ? 'true' : 'false');
  drawChart();
}
(function initTheme(){
  let t = null;
  try { t = localStorage.getItem('scs_theme'); } catch {}
  if (t !== 'light' && t !== 'dark') t = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  document.documentElement.dataset.theme = t;
  const b = $('btnTheme'); if (b) b.setAttribute('aria-pressed', t === 'dark' ? 'true' : 'false');
})();
$('btnTheme').onclick = ()=>{ applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'); };

// ---------- INIT ----------
buildGrid(6); buildLogHead(6); syncButtons(); renderSensors(); renderLogs(); renderEvents(); drawChart(); renderSprinkler();
SCSSource.start(sourceHooks());
if (!SCSSource.isLive()){ $('fbStatus').textContent = 'Simulasi lokal berjalan (tanpa ESP32).'; setConn('sim'); }
setInterval(updateSchedHint, 30000);
