/* Smart Cow Sprinkler — app logic (simulation-first + MQTT ready) */
const $ = (id) => document.getElementById(id);
const SENSOR_NAMES = ['Titik 1 • Depan', 'Titik 2 • Depan', 'Titik 3 • Tengah', 'Titik 4 • Tengah', 'Titik 5 • Belakang', 'Titik 6 • Belakang'];
const COLORS = ['#f87171','#fb923c','#facc15','#4ade80','#60a5fa','#c084fc'];
const AVG_COLOR = '#22d3ee';

let temps = [30.1, 30.4, 29.8, 30.2, 29.9, 30.0];
let lastUpdate = null;
let sprinklerOn = false;
let sprayStart = null;
let lastSprayEnd = 0;
let history = [];   // {t, s:[6], avg} tiap 2 detik, maks 1800 (1 jam)
let logs = JSON.parse(localStorage.getItem('scs_logs') || '[]'); // tiap 30 detik, maks 120
let events = JSON.parse(localStorage.getItem('scs_events') || '[]');
let fbConnected = false;
let sensorCount = null;
let lastLogTime = 0;

try { history = JSON.parse(localStorage.getItem('scs_hist') || '[]'); } catch { history = []; }
if (!Array.isArray(history)) history = [];
history = history.slice(-1800);

// ---------- THEME (light/dark) ----------
function curTheme(){ return localStorage.getItem('scs_theme') || 'dark'; }
function applyTheme(t){
  document.documentElement.dataset.theme = t === 'light' ? 'light' : 'dark';
  localStorage.setItem('scs_theme', document.documentElement.dataset.theme);
  const b = $('themeBtn'); if (b) b.textContent = document.documentElement.dataset.theme === 'light' ? '☀️' : '🌙';
  if (typeof drawChart === 'function') drawChart();
}
function chartTheme(){
  return document.documentElement.dataset.theme === 'light'
    ? { grid: '#cbd5e1', txt: '#475569', empty: '#64748b' }
    : { grid: '#223152', txt: '#93a3c4', empty: '#93a3c4' };
}

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
  if (t >= CFG.threshold + 1) return '#ef4444';
  if (t >= CFG.threshold) return '#f59e0b';
  if (t >= CFG.threshold - 1) return '#4ade80';
  return '#60a5fa';
}
function renderSensors(){
  const shown = temps.slice(0, renderedCount);
  let mn = 99, mx = -99;
  shown.forEach((t,i)=>{
    mn = Math.min(mn,t); mx = Math.max(mx,t);
    const el = $('sensor'+i); if(!el) return;
    el.querySelector('.s-temp').textContent = t.toFixed(1)+'°';
    el.querySelector('.s-temp').style.color = tempColor(t);
    const pct = Math.min(100, Math.max(4, (t-25)/(38-25)*100));
    const bar = el.querySelector('.bar i');
    bar.style.width = pct+'%'; bar.style.background = tempColor(t);
    const st = el.querySelector('.s-state');
    if (t >= CFG.threshold){ st.textContent = 'PANAS'; st.className = 's-state hot'; }
    else if (t >= CFG.threshold - CFG.hysteresis){ st.textContent = 'WASPADA'; st.className = 's-state warn'; }
    else { st.textContent = 'NORMAL'; st.className = 's-state ok'; }
  });
  const avg = SCS.avgOf(shown);
  $('avgTemp').textContent = avg.toFixed(1);
  $('minTemp').textContent = mn.toFixed(1)+'°C';
  $('maxTemp').textContent = mx.toFixed(1)+'°C';
  $('thresholdLabel').textContent = CFG.threshold.toFixed(1)+'°C';
  const pill = $('avgStatus');
  if (avg >= CFG.threshold + 1){ pill.textContent='🔥 STRESS PANAS — SEMPROT!'; pill.className='status-pill bahaya'; }
  else if (avg >= CFG.threshold){ pill.textContent='⚠️ WASPADA — AMBANG TERSENTUH'; pill.className='status-pill waspada'; }
  else { pill.textContent='✅ NORMAL — SAPI NYAMAN'; pill.className='status-pill normal'; }
  if (lastUpdate) $('updateAge').textContent = 'update: ' + new Date(lastUpdate).toLocaleTimeString('id-ID',{timeZone:'Asia/Jakarta'}) + ' WIB';
  return avg;
}

// ---------- SPRINKLER (perintah manual ke ESP32 via Firebase) ----------
function setSprinkler(on, reason){
  if (!fbConnected || !window.SCSFirebase){ $('sprinklerReason').textContent = 'Firebase belum terhubung.'; return; }
  SCSFirebase.pushOverride(on, reason);
  $('sprinklerReason').textContent = 'Perintah dikirim, menunggu ESP32 mengeksekusi…';
}
function renderSprinkler(){
  const box = $('sprinklerState');
  box.className = 'sprinkler ' + (sprinklerOn ? 'on' : 'off');
  $('sprinklerText').textContent = sprinklerOn ? 'MENYEMPROT 💦' : 'MATI';
  if (sprinklerOn && sprayStart){
    const el = Math.floor((Date.now()-sprayStart)/1000);
    const left = CFG.maxDuration - el;
    $('sprinklerTimer').textContent = `⏱ Jalan ${el} dtk • auto-off dalam ${Math.max(0,left)} dtk`;
    if (left <= 0) setSprinkler(false, `durasi maks ${CFG.maxDuration} dtk tercapai (proteksi air)`);
  } else {
    $('sprinklerTimer').textContent = CFG.mode==='manual' ? 'Mode manual — gunakan tombol.' : 'Mode otomatis — menunggu ambang.';
  }
}
setInterval(renderSprinkler, 1000);

function autoControl(avg){
  // Relay fisik milik ESP32; web hanya mirror status + tampilkan rekomendasi.
  if (CFG.mode !== 'auto' || fbConnected){
    if (CFG.mode==='auto' && fbConnected){
      if (curAutoSrc() === 'schedule'){
        const act = schedActiveNow();
        const slots = schedSlots();
        const daftar = slots.map((s) => `${shortDate(s.date)} ${s.start}`).join(', ');
        $('sprinklerReason').textContent = act
          ? `Rekomendasi: NYALA (jadwal ${daftar}). ESP mengeksekusi.`
          : `Standby jadwal (${slots.length}×: ${daftar}).`;
      } else if (avg >= CFG.threshold && !sprinklerOn) $('sprinklerReason').textContent = `Rekomendasi: NYALA (avg ${avg.toFixed(1)} ≥ ${CFG.threshold.toFixed(1)}°C). ESP mengeksekusi.`;
      else if (avg <= CFG.threshold - CFG.hysteresis && sprinklerOn) $('sprinklerReason').textContent = 'Rekomendasi: MATI.';
    }
    return;
  }
  const d = SCS.decideAuto(avg, sprinklerOn, CFG, schedActiveNow());
  if (d === 'on') setSprinkler(true, curAutoSrc() === 'schedule' ? 'jadwal harian' : `avg ${avg.toFixed(1)}°C ≥ threshold ${CFG.threshold.toFixed(1)}°C`);
  else if (d === 'off') setSprinkler(false, curAutoSrc() === 'schedule' ? 'jadwal selesai' : `avg ${avg.toFixed(1)}°C ≤ ${(CFG.threshold-CFG.hysteresis).toFixed(1)}°C (hysteresis)`);
  else if (!sprinklerOn) $('sprinklerReason').textContent = curAutoSrc() === 'schedule' ? 'Standby jadwal — menunggu jam semprot.' : `Standby — avg ${avg.toFixed(1)}°C < ${CFG.threshold.toFixed(1)}°C`;
}

// ---------- DATA MASUK (dari Firebase via ESP32) ----------
function onNewData(arr){
  temps = arr.slice(0,6);
  lastUpdate = Date.now();
  const st = $('sensorTitle'); if (st) st.textContent = SCS.sensorTitle(sensorCount);
  if (renderedCount === 0) return;
  const avg = renderSensors();
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
  const T = chartTheme();
  const W = c.width = c.clientWidth * 2, H = c.height = 440;
  ctx.clearRect(0,0,W,H);
  if (history.length < 2){ ctx.fillStyle=T.empty; ctx.font='28px sans-serif'; ctx.fillText('Menunggu data…', 30, 60); return; }
  const data = history.slice(-720);
  let mn = 99, mx = -99;
  data.forEach(d=>{ d.s.forEach(v=>{mn=Math.min(mn,v);mx=Math.max(mx,v);}); });
  mn = Math.min(mn, CFG.threshold-2)-0.3; mx = Math.max(mx, CFG.threshold+2)+0.3;
  const X = i => 60 + i/(data.length-1)*(W-80);
  const Y = v => 20 + (1-(v-mn)/(mx-mn))*(H-70);
  // grid + threshold
  ctx.strokeStyle=T.grid; ctx.fillStyle=T.txt; ctx.font='22px sans-serif';
  for(let k=0;k<=4;k++){ const v=mn+(mx-mn)*k/4, y=Y(v);
    ctx.beginPath(); ctx.moveTo(60,y); ctx.lineTo(W-20,y); ctx.stroke();
    ctx.fillText(v.toFixed(1)+'°', 4, y+7); }
  const yT = Y(CFG.threshold);
  ctx.setLineDash([12,8]); ctx.strokeStyle='#f59e0b'; ctx.lineWidth=3;
  ctx.beginPath(); ctx.moveTo(60,yT); ctx.lineTo(W-20,yT); ctx.stroke(); ctx.setLineDash([]);
  ctx.fillStyle='#fbbf24'; ctx.fillText('threshold '+CFG.threshold.toFixed(1)+'°', 70, yT-10);
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
      + `<td><b>${r.avg.toFixed(1)}</b></td><td>${hot?'🔥 PANAS':'✅ OK'}</td><td>${r.spray?'💦 ON':'—'}</td>`;
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
    li.innerHTML = `<div>${e.msg}</div><div class="t">${new Date(e.t).toLocaleString('id-ID',{timeZone:'Asia/Jakarta'})} WIB</div>`;
    ul.appendChild(li);
  });
}

// ---------- MODE + SOURCE (eksklusif: threshold ATAU schedule) ----------
function curAutoSrc(){
  if (typeof SCS !== 'undefined' && SCS.autoSrcOf) return SCS.autoSrcOf(CFG);
  return CFG.autoSrc || (CFG.schedOn ? 'schedule' : 'threshold');
}
function schedSlots(){ return SCS.schedulesOf(CFG, SCS.wibDateStr()); }
function schedActiveNow(){
  return SCS.anyScheduleActive(Date.now(), schedSlots());
}
// "HH:MM" WIB untuk nowMs (buat batas min input jam hari ini).
function wibHM(nowMs){
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date(nowMs));
  const g = (t) => p.find((x) => x.type === t).value;
  return `${g('hour')}:${g('minute')}`;
}
function shortDate(d){ const p = (d || '').split('-'); return p.length === 3 ? `${p[2]}-${p[1]}` : d; }
// ---------- EDITOR DAFTAR JADWAL (maks 6 slot bertanggal) ----------
// Aturan: tanggal bebas (min hari ini). Khusus hari ini, jam min = sekarang+1 mnt.
function renderSchedList(){
  const box = $('schedList'); if (!box) return;
  const locked = CFG.mode !== 'auto';
  const today = SCS.wibDateStr(), minTime = wibHM(Date.now() + 60000);
  box.innerHTML = '';
  schedSlots().forEach((s, i) => {
    const row = document.createElement('div');
    row.className = 'sched-row';
    row.innerHTML = `<span class="sched-num">${i + 1}</span>
      <input type="date" data-k="date" value="${s.date}" min="${today}" ${locked ? 'disabled' : ''} />
      <input type="time" data-k="start" value="${s.start}" ${s.date === today ? `min="${minTime}"` : ''} ${locked ? 'disabled' : ''} />
      <input type="number" data-k="dur" step="1" min="1" max="180" value="${s.dur}" title="Lama nyala (menit)" ${locked ? 'disabled' : ''} />
      <span class="hint">mnt</span>
      <button class="btn red small" data-del="${i}" title="Hapus jadwal ini" ${locked ? 'disabled' : ''}>✕</button>`;
    box.appendChild(row);
  });
  box.querySelectorAll('input').forEach((el) => {
    el.onchange = () => { CFG.schedules = readSchedList(); saveCfg(); syncButtons(); };
  });
  box.querySelectorAll('[data-del]').forEach((btn) => {
    btn.onclick = () => {
      const cur = readSchedList(true);
      cur.splice(+btn.dataset.del, 1);
      CFG.schedules = cur.length ? cur : defaultSchedules();
      saveCfg(); syncButtons(); pushEvent('Jadwal dihapus, sisa ' + CFG.schedules.length + '×'); fbPushControl();
    };
  });
  const add = $('btnAddSched'); if (add) add.disabled = CFG.mode !== 'auto' || schedSlots().length >= 6;
}
function readSchedList(keepPast){
  const box = $('schedList'); if (!box) return schedSlots();
  const now = Date.now();
  const rows = [...box.querySelectorAll('.sched-row')];
  const out = [];
  rows.forEach((row) => {
    const date = row.querySelector('[data-k="date"]').value || '';
    const st = row.querySelector('[data-k="start"]').value || '';
    const du = Math.min(180, Math.max(1, parseInt(row.querySelector('[data-k="dur"]').value) || 10));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !isFinite(SCS.hmToMin(st))) return;
    if (out.some((s) => s.date === date && s.start === st)) return;
    const slot = { date, start: st, dur: du };
    if (!keepPast && SCS.slotState(slot, now) === 'past') return; // yang sudah lewat dibuang
    out.push(slot);
  });
  out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : SCS.hmToMin(a.start) - SCS.hmToMin(b.start)));
  return out.length ? out.slice(0, 6) : defaultSchedules();
}
function syncButtons(){
  $('btnAuto').classList.toggle('active', CFG.mode==='auto');
  $('btnManual').classList.toggle('active', CFG.mode==='manual');
  $('btnSprayOn').disabled = $('btnSprayOff').disabled = CFG.mode!=='manual';
  const locked = CFG.mode !== 'auto';
  const src = curAutoSrc();
  const isThresh = src === 'threshold';
  $('srcThreshold').checked = isThresh;
  $('srcSchedule').checked = !isThresh;
  $('srcThreshold').disabled = $('srcSchedule').disabled = locked;
  ['inThreshold','inHyst','rangeThreshold'].forEach((id)=>{ $(id).disabled = locked || !isThresh; });
  ['inMaxDur','inCooldown'].forEach((id)=>{ $(id).disabled = locked; });
  $('btnSaveCfg').disabled = locked;
  $('btnSaveCfg').textContent = locked ? '🔒 Terkunci saat mode manual' : '💾 Simpan Pengaturan';
  $('inThreshold').value = CFG.threshold; $('rangeThreshold').value = CFG.threshold;
  $('inHyst').value = CFG.hysteresis; $('inMaxDur').value = CFG.maxDuration; $('inCooldown').value = CFG.cooldown;
  // Conditional: hanya grup yang kepilih yang tampil (yang lain display:none biar clean).
  // Mode suhu -> threshold + proteksi. Mode jadwal -> daftar slot saja (tanpa cooldown/proteksi).
  $('threshGroup').style.display = isThresh ? '' : 'none';
  $('protectGroup').style.display = isThresh ? '' : 'none';
  $('schedGroup').style.display = isThresh ? 'none' : '';
  renderSchedList();
  updateSchedHint();
}
$('btnAuto').onclick = ()=>{ CFG.mode='auto'; saveCfg(); syncButtons(); pushEvent('Mode → OTOMATIS'); fbPushControl(); };
$('btnManual').onclick = ()=>{ CFG.mode='manual'; saveCfg(); syncButtons(); pushEvent('Mode → MANUAL'); fbPushControl(); };
$('btnSprayOn').onclick = ()=> setSprinkler(true, 'tombol manual');
$('btnSprayOff').onclick = ()=> setSprinkler(false, 'tombol manual');
function fbPushControl(){
  if (fbConnected && window.SCSFirebase){
    const slots = schedSlots();
    const ctl = { mode: CFG.mode, autoSrc: curAutoSrc(), threshold: CFG.threshold, hysteresis: CFG.hysteresis, maxDuration: CFG.maxDuration, cooldown: CFG.cooldown, schN: slots.length, schOn: curAutoSrc() === 'schedule' && slots.length ? 1 : 0 };
    slots.forEach((s, i) => { ctl['sch' + (i + 1) + 'Date'] = s.date; ctl['sch' + (i + 1) + 'Start'] = s.start; ctl['sch' + (i + 1) + 'Dur'] = s.dur; });
    // Kompatibel firmware lama (1 jadwal): slot pertama.
    if (slots.length){ ctl.schStart = slots[0].start; ctl.schDur = slots[0].dur; }
    SCSFirebase.pushControl(ctl);
  }
}
function wibMinutes(){
  const p = new Intl.DateTimeFormat('id-ID',{timeZone:'Asia/Jakarta',hour:'numeric',minute:'numeric',hour12:false}).formatToParts(new Date());
  return (+p.find(x=>x.type==='hour').value) * 60 + (+p.find(x=>x.type==='minute').value);
}
function updateSchedHint(){
  const el = $('schedHint'); if (!el) return;
  if (curAutoSrc() === 'threshold'){ el.textContent = ''; el.style.display = 'none'; return; }
  el.style.display = '';
  const slots = schedSlots();
  if (!slots.length){ el.textContent = 'Belum ada jadwal — tambah minimal 1.'; return; }
  const now = Date.now();
  const run = SCS.anyScheduleActive(now, slots);
  const nx = SCS.nextSchedule(now, slots);
  const daftar = slots.map((s) => `${shortDate(s.date)} ${s.start} (${s.dur} mnt)`).join(', ');
  el.textContent = `${slots.length}×: ${daftar}. ` + (run ? 'SEDANG BERJALAN 💦' : (nx ? `Berikutnya ${shortDate(nx.date)} ${nx.start} WIB.` : ''));
}
let fbTries = 0;
// fbStatus hanya tampil saat belum live (sim/error) biar tampilan clean.
function setFbStatus(msg, kind){
  const el = $('fbStatus'); if (!el) return;
  el.textContent = msg || '';
  el.style.display = (kind === 'live' || !msg) ? 'none' : '';
}
function fbConnect(){
  if (!window.SCSFirebase){ // module SDK belum termuat, coba lagi sebentar
    fbTries++;
    setFbStatus(fbTries > 12
      ? 'Gagal memuat Firebase SDK. Buka via https://smartcow-de25f.web.app (bukan file lokal), matikan adblock untuk gstatic.com, lalu refresh.'
      : 'Memuat Firebase SDK…', 'sim');
    setTimeout(()=>{ if (!fbConnected) fbConnect(); }, 800);
    return;
  }
  setFbStatus('Menghubungkan ke Firebase…', 'sim');
  SCSFirebase.connect({
    onStatus: (msg, kind)=>{ setFbStatus(msg, kind); setConn(kind); },
    onTelemetry: (p)=>{
      fbConnected = true; setConn('live');
      if (p && Array.isArray(p.s)){
        sensorCount = (typeof p.n === 'number') ? p.n : null;
        const vc = SCS.visibleCount(sensorCount);
        if (vc != null && vc !== renderedCount){ buildGrid(vc); buildLogHead(vc); }
        onNewData(p.s);
        if (typeof p.ssr === 'number' && ((p.ssr === 1) !== sprinklerOn)){
          sprinklerOn = p.ssr === 1; sprayStart = sprinklerOn ? Date.now() : null;
          if (!sprinklerOn) lastSprayEnd = Date.now();
          pushEvent(sprinklerOn ? (p.sch ? '💦 ESP32: Sprinkler ON (jadwal)' : '💦 ESP32: Sprinkler ON') : '⛔ ESP32: Sprinkler OFF');
          renderSprinkler();
        }
      }
    },
    onSeedLogs: (rows)=>{ if (rows.length){ logs = SCS.pruneLogs(rows, 120); localStorage.setItem('scs_logs', JSON.stringify(logs)); renderLogs(); } }
  }).then((ok)=>{ fbConnected = !!ok; if (ok){ setFbStatus('', 'live'); fbPushControl(); } })
    .catch((e)=>{ setFbStatus('Firebase: ' + e.message, 'err'); setConn('err'); });
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
$('srcThreshold').onchange = () => { CFG.autoSrc = 'threshold'; CFG.schedOn = false; saveCfg(); syncButtons(); renderSensors(); };
$('srcSchedule').onchange = () => { CFG.autoSrc = 'schedule'; CFG.schedOn = true; saveCfg(); syncButtons(); renderSensors(); };
$('btnSaveCfg').onclick = ()=>{
  CFG.autoSrc = $('srcSchedule').checked ? 'schedule' : 'threshold';
  CFG.schedOn = CFG.autoSrc === 'schedule';
  CFG.threshold = Math.min(40, Math.max(25, parseFloat($('inThreshold').value)||30));
  CFG.hysteresis = parseFloat($('inHyst').value)||1;
  CFG.maxDuration = parseInt($('inMaxDur').value)||120;
  CFG.cooldown = parseInt($('inCooldown').value)||60;
  CFG.schedules = readSchedList();
  saveCfg(); syncButtons(); renderSensors(); drawChart();
  const slots = schedSlots();
  pushEvent(CFG.autoSrc === 'schedule'
    ? `Pengaturan disimpan: mode JADWAL ${slots.length}× (${slots.map((s)=>shortDate(s.date)+' '+s.start+' +'+s.dur+'mnt').join(', ')})`
    : `Pengaturan disimpan: mode SUHU threshold ${CFG.threshold}°C, hyst ${CFG.hysteresis}°C`);
  fbPushControl();
};
$('btnAddSched').onclick = ()=>{
  const cur = readSchedList(true);
  if (cur.length >= 6) return;
  // Slot baru = 60 mnt setelah slot terakhir; lewat tengah malam -> tanggal maju 1 hari.
  const last = cur[cur.length - 1];
  const h = SCS.hmToMin(last.start);
  const nh = isFinite(h) ? (h + 60) % 1440 : 9 * 60;
  let ndate = last.date;
  if (isFinite(h) && nh <= h){
    const p = last.date.split('-').map(Number);
    ndate = new Date(Date.UTC(p[0], p[1] - 1, p[2]) + 86400000).toISOString().slice(0, 10);
  }
  const ns = `${String(Math.floor(nh / 60)).padStart(2, '0')}:${String(nh % 60).padStart(2, '0')}`;
  CFG.schedules = [...cur, { date: ndate, start: ns, dur: 10 }];
  saveCfg(); syncButtons();
};

// ---------- INIT (sumber tunggal: Firebase) ----------
applyTheme(curTheme());
$('themeBtn').onclick = ()=> applyTheme(curTheme() === 'light' ? 'dark' : 'light');
buildGrid(6); buildLogHead(6); syncButtons(); renderSensors(); renderLogs(); renderEvents(); drawChart(); renderSprinkler();
fbConnect();
setInterval(updateSchedHint, 30000);
