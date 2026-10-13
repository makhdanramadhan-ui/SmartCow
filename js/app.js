/* SmartCow FINAL — Firebase, 6 DS18B20 + 4 DHT22. Relay milik ESP kanan. */
const $ = (id) => document.getElementById(id);
const SENSOR_NAMES = ['Titik 1 • Depan', 'Titik 2 • Depan', 'Titik 3 • Tengah', 'Titik 4 • Tengah', 'Titik 5 • Belakang', 'Titik 6 • Belakang'];
const COLORS = ['#b5734d','#a28c3c','#678c53','#4a8b82','#608aad','#a87a95'];
const AVG_COLOR = '#739b50';

let temps = Array(6).fill(null);
let humidities = Array(4).fill(null);
let telemetry = null, sensorView = SCSTelemetry.view(null), transportConnected = false;
const fmtValue = (value, digits = 1) => SCSTelemetry.finite(value) ? value.toFixed(digits) : '—';
let lastUpdate = null;
let sprinklerOn = false;
let sprayStart = null;
let lastSprayEnd = 0;
let history = [];   // {t, s:[6], avg} tiap 2 detik, maks 1800 (1 jam)
let logs = [];
let events = [];
try { const saved = JSON.parse(localStorage.getItem('scs_events') || '[]'); if (Array.isArray(saved)) events = saved.slice(0,50); } catch {}
let fbConnected = false;
let controlLoaded = false;
let appliedCfg = SCSControl.normalize(CFG), settingsDirty = false, savingSettings = false;
const basisName = cfg => cfg.controlBasis === 'thi' ? 'THI' : 'Suhu';
const basisUnit = cfg => cfg.controlBasis === 'thi' ? ' THI' : ' °C';
const metricValue = (view,cfg) => cfg.controlBasis === 'thi' ? view.thi : view.avg;
const firmwareReady = () => sensorView.online && sensorView.controlPolicyVersion === 2;
const profileOf = basis => appliedCfg.profiles[basis];
function markSettingsDirty(){ settingsDirty=true; saveCfg(); $('settingsStatus').textContent='Perubahan belum dikirim. Klik Simpan Pengaturan untuk menerapkan.'; }

// ---------- THEME (light/dark) ----------
function curTheme(){ return localStorage.getItem('scs_theme') || 'light'; }
function applyTheme(t){
  document.documentElement.dataset.theme = t === 'light' ? 'light' : 'dark';
  localStorage.setItem('scs_theme', document.documentElement.dataset.theme);
  const light = document.documentElement.dataset.theme === 'light';
  const b = $('themeBtn');
  if (b){ b.textContent = light ? '☾' : '☼'; b.title = light ? 'Gunakan tema gelap' : 'Gunakan tema terang'; b.setAttribute('aria-label', b.title); }
  if (typeof drawChart === 'function') drawChart();
}
function chartTheme(){
  return document.documentElement.dataset.theme === 'light'
    ? { grid: '#dfe5d6', txt: '#70806a', empty: '#78846e', threshold: '#a77935', thi: '#527d48' }
    : { grid: '#324b3a', txt: '#b3c3aa', empty: '#a5b5a4', threshold: '#e2bf77', thi: '#b7d69f' };
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

// ---------- SENSOR GRID (posisi tetap; sensor putus tidak menggeser kartu) ----------
let renderedCount = 6;
function buildGrid(count){
  renderedCount = count;
  const g = $('sensorGrid'); g.innerHTML = '';
  g.style.display = count === 0 ? 'none' : '';
  $('noSensor').style.display = count === 0 ? 'block' : 'none';
  for (let i = 0; i < count; i++){
    const d = document.createElement('div');
    d.className = 'sensor'; d.id = 'sensor'+i;
    d.innerHTML = `<div class="sensor-meta"><span>DS${i+1}</span><span>${i < 3 ? 'KANAN' : 'KIRI'}</span></div><div class="s-name">${SENSOR_NAMES[i]}</div>
      <div class="s-temp">—</div>
      <div class="bar"><i></i></div>
       <div class="s-state off">MENUNGGU</div>`;
    g.appendChild(d);
  }
  renderLegend();
}
function renderLegend(){
  const leg = $('legend'); leg.innerHTML = '';
  const rh = $('chartMetric').value === 'humidity';
  if ($('chartMetric').value === 'thi'){ leg.textContent='THI agregat · 6 DS + 4 DHT'; return; }
  for (let i = 0; i < (rh ? 4 : 6); i++){
    const s = document.createElement('span');
    s.innerHTML = `<i style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${COLORS[i]}"></i> ${rh ? 'DHT' : 'DS'}${i+1}`;
    leg.appendChild(s);
  }
}
function buildHumidityGrid(){
  $('humidityGrid').innerHTML = Array.from({length:4}, (_,i) => `<div class="sensor humidity-sensor" id="humidity${i}"><div class="sensor-meta"><span>DHT${i+1}</span><span>${i < 2 ? 'KANAN' : 'KIRI'}</span></div><div class="s-name">Kelembapan udara</div><div class="s-temp">—</div><div class="bar"><i></i></div><div class="dht-companion hint">Suhu DHT: —</div><div class="s-state off">MENUNGGU</div></div>`).join('');
}
function buildLogHead(count){
  const tr = $('logHead'); if (!tr) return;
  let h = '<th>Waktu (WIB)</th>';
  for (let i = 1; i <= count; i++) h += `<th>DS${i} °C</th>`;
  for (let i = 1; i <= 4; i++) h += `<th>DHT${i} %RH</th>`;
  h += '<th>Rata² DS</th><th>Rata² RH</th><th>THI</th><th>Status dasar terpilih</th><th>Sprinkler</th>';
  tr.innerHTML = h;
}
function tempColor(t){
  const threshold=profileOf('temperature').threshold;
  const style=getComputedStyle(document.documentElement);
  if (t >= threshold + 1) return style.getPropertyValue('--negative-txt');
  if (t >= threshold) return style.getPropertyValue('--warning-txt');
  if (t >= threshold - 1) return style.getPropertyValue('--positive-txt');
  return style.getPropertyValue('--cool-txt');
}
function renderSensors(){
  const tempProfile=profileOf('temperature'), thiProfile=profileOf('thi');
  const shown = temps.filter(SCSTelemetry.finite);
  temps.forEach((t,i)=>{
    const el = $('sensor'+i); if(!el) return;
    const valid = SCSTelemetry.finite(t);
    el.classList.toggle('sensor-unavailable', !valid);
    if (!valid){
      el.querySelector('.s-temp').textContent = '—';
      el.querySelector('.bar i').style.width = '0%';
      const st = el.querySelector('.s-state'); st.className = 's-state off';
      st.textContent = sensorView.dsStates[i] === 'stale' ? 'DATA LAMA' : 'BELUM TERBACA';
      return;
    }
    el.querySelector('.s-temp').textContent = t.toFixed(1)+'°C';
    el.querySelector('.s-temp').style.color = tempColor(t);
    const pct = Math.min(100, Math.max(4, (t-25)/(38-25)*100));
    const bar = el.querySelector('.bar i');
    bar.style.width = pct+'%'; bar.style.background = tempColor(t);
    const st = el.querySelector('.s-state');
    if (t >= tempProfile.threshold){ st.textContent = 'PANAS'; st.className = 's-state hot'; }
    else if (t >= tempProfile.threshold - tempProfile.hysteresis){ st.textContent = 'WASPADA'; st.className = 's-state warn'; }
    else { st.textContent = 'NORMAL'; st.className = 's-state ok'; }
  });
  const avg = sensorView.avg;
  $('avgTemp').textContent = fmtValue(avg);
  $('minTemp').textContent = shown.length ? Math.min(...shown).toFixed(1)+'°C' : '—';
  $('maxTemp').textContent = shown.length ? Math.max(...shown).toFixed(1)+'°C' : '—';
  $('thresholdLabel').textContent = tempProfile.threshold.toFixed(1)+'°C';
  const pill = $('avgStatus');
  if (!SCSTelemetry.finite(avg)){ pill.textContent='DATA BELUM TERSEDIA'; pill.className='status-pill neutral'; }
  else if (!sensorView.complete){ pill.textContent='DATA PARSIAL · AUTO SUHU DIBLOKIR'; pill.className='status-pill waspada'; }
  else if (avg >= tempProfile.threshold + 1){ pill.textContent='SUHU TINGGI · DI ATAS AMBANG'; pill.className='status-pill bahaya'; }
  else if (avg >= tempProfile.threshold){ pill.textContent='⚠️ WASPADA — AMBANG TERSENTUH'; pill.className='status-pill waspada'; }
  else { pill.textContent='DI BAWAH AMBANG SUHU'; pill.className='status-pill normal'; }
  $('dsSummary').textContent = `${sensorView.validCount}/6 DS valid · rata-rata ${sensorView.complete ? 'lengkap' : 'parsial'}${sensorView.legacy ? ' · firmware lama' : ''}`;
  $('sensorTitle').textContent = `6 titik suhu · ${sensorView.validCount} valid`;
  $('noSensor').style.display = telemetry && !shown.length ? '' : 'none';
  $('updateAge').textContent = sensorView.ts ? 'Update ' + new Date(sensorView.ts).toLocaleTimeString('id-ID',{timeZone:'Asia/Jakarta'}) + ' WIB · ' + (sensorView.online ? 'terkini' : 'kedaluwarsa') : 'Belum ada telemetry';
  humidities.forEach((h,i) => {
    const el = $('humidity'+i), valid = SCSTelemetry.finite(h); if (!el) return;
    el.classList.toggle('sensor-unavailable', !valid);
    el.querySelector('.s-temp').textContent = valid ? h.toFixed(1) + '%' : '—';
    el.querySelector('.bar i').style.width = valid ? h + '%' : '0%';
    el.querySelector('.dht-companion').textContent = 'Suhu DHT: ' + fmtValue(sensorView.d[i]) + ' °C';
    const st = el.querySelector('.s-state'); st.className = 's-state ' + (valid ? 'ok' : 'off');
    st.textContent = valid ? 'TERBACA' : sensorView.rhStates[i] === 'stale' ? 'DATA LAMA' : 'BELUM TERBACA';
  });
  const goodRH = humidities.filter(SCSTelemetry.finite);
  $('avgHumidity').textContent = fmtValue(sensorView.humidityAvg);
  $('minHumidity').textContent = goodRH.length ? Math.min(...goodRH).toFixed(1)+'%' : '—';
  $('maxHumidity').textContent = goodRH.length ? Math.max(...goodRH).toFixed(1)+'%' : '—';
  $('humidityCount').textContent = `${sensorView.humidityValidCount}/4 valid`;
  $('rhSummary').textContent = `${sensorView.humidityValidCount}/4 DHT valid · RH untuk THI`;
  $('humidityStatus').textContent = sensorView.humidityComplete ? '4 TITIK TERPANTAU' : goodRH.length ? 'DATA KELEMBAPAN PARSIAL' : 'DATA BELUM TERSEDIA';
  $('humidityStatus').className = 'status-pill ' + (sensorView.humidityComplete ? 'normal' : 'neutral');
  $('thiValue').textContent=fmtValue(sensorView.thi);
  $('thiThresholdLabel').textContent=thiProfile.threshold.toFixed(1);
  $('thiSummary').textContent=`${sensorView.validCount}/6 DS + ${sensorView.humidityValidCount}/4 DHT valid · THI agregat, bukan per titik`;
  const thiPill=$('thiStatus');
  thiPill.textContent=sensorView.thiComplete ? sensorView.thi>=thiProfile.threshold ? 'THRESHOLD THI TERCAPAI' : 'DI BAWAH THRESHOLD THI' : 'PERLU 6 DS + 4 DHT VALID';
  thiPill.className='status-pill '+(sensorView.thiComplete ? sensorView.thi>=thiProfile.threshold ? 'waspada' : 'normal' : 'neutral');
  for (const [id, name, online] of [['rightNode','ESP kanan',sensorView.online],['leftNode','ESP kiri',sensorView.leftOnline]]){
    $(id).textContent = `${name} · ${online ? 'online' : 'belum terhubung'}`; $(id).classList.toggle('online', online);
  }
  $('heroHealth').textContent = sensorView.thiComplete ? '10 input valid · iklim terpantau' : sensorView.online ? `${sensorView.validCount}/6 DS · ${sensorView.humidityValidCount}/4 DHT valid` : 'Menunggu pembacaan sensor terkini';
  $('heroHealth').classList.toggle('complete', sensorView.thiComplete);
  return avg;
}

function refreshTelemetry(){
  sensorView = SCSTelemetry.view(telemetry, window.SCSFirebase?.now() || Date.now());
  temps = sensorView.s; humidities = sensorView.h;
  renderSensors(); renderSprinkler();
  setConn(fbConnected ? (!transportConnected ? 'err' : sensorView.online ? 'live' : 'offline') : 'login');
  $('btnSprayOn').disabled = $('btnSprayOff').disabled = CFG.mode !== 'manual' || !controlLoaded || !fbConnected || !sensorView.online || !transportConnected;
  $('btnManual').disabled = !fbConnected || !controlLoaded || !transportConnected || !sensorView.online || savingSettings;
  $('btnAuto').disabled = $('btnManual').disabled || !firmwareReady();
  autoControl(sensorView.avg);
  $('firmwareNotice').hidden=firmwareReady();
  $('btnSaveCfg').disabled = CFG.mode!=='auto' || !fbConnected || !controlLoaded || !transportConnected || !firmwareReady() || savingSettings;
  $('btnLogNow').disabled = !sensorView.online || !fbConnected;
}

// ---------- SPRINKLER (perintah manual ke ESP32 via Firebase) ----------
async function setSprinkler(on, reason){
  if (!fbConnected || !controlLoaded || !sensorView.online || !transportConnected || CFG.mode !== 'manual' || !window.SCSFirebase){ $('sprinklerReason').textContent = 'Perangkat offline atau mode belum siap; perintah tidak dikirim.'; return; }
  try { await SCSFirebase.pushOverride(on, reason); }
  catch { $('sprinklerReason').textContent = 'Perintah gagal dikirim.'; return; }
  $('sprinklerReason').textContent = 'Perintah dikirim, menunggu ESP32 mengeksekusi…';
}
function renderSprinkler(){
  const box = $('sprinklerState');
  if (sensorView.ssr === null){
    box.className = 'sprinkler unknown'; $('sprinklerText').textContent = 'BELUM DIKETAHUI';
    $('sprinklerTimer').textContent = 'Menunggu status relay terbaru dari ESP kanan.';
    return;
  }
  box.className = 'sprinkler ' + (sprinklerOn ? 'on' : 'off');
  $('sprinklerText').textContent = sprinklerOn ? 'MENYEMPROT 💦' : 'MATI';
  if (sprinklerOn && sprayStart){
    const el = Math.floor((Date.now()-sprayStart)/1000);
    $('sprinklerTimer').textContent = appliedCfg.mode === 'manual' ? 'Manual ON · tetap nyala sampai perintah OFF.' : `Terpantau nyala ${el} dtk · ${basisName(appliedCfg)}, hysteresis/durasi/cooldown di ESP.`;
  } else {
    $('sprinklerTimer').textContent = appliedCfg.mode==='manual' ? 'Mode manual — gunakan tombol.' : `Otomatis ${basisName(appliedCfg)} · ${appliedCfg.autoSrc==='schedule' ? 'dalam jendela jadwal' : 'sepanjang waktu'}.`;
  }
}
setInterval(renderSprinkler, 1000);

function autoControl(avg){
  if (!sensorView.online){ $('sprinklerReason').textContent = 'Tidak ada status perangkat terbaru. Nilai lama tidak dipakai sebagai data live.'; return; }
  if (appliedCfg.mode==='auto' && !firmwareReady()){ $('sprinklerReason').textContent='Firmware kanan belum mendukung kebijakan baru. Upload v3.1; status relay tetap mengikuti laporan perangkat.'; return; }
  if (appliedCfg.mode==='auto' && sensorView.controlBasis!==appliedCfg.controlBasis){ $('sprinklerReason').textContent='Setting tersimpan; menunggu ESP kanan menerapkan dasar kontrol yang dipilih.'; return; }
  const complete=appliedCfg.controlBasis==='thi' ? sensorView.thiComplete : sensorView.complete;
  if(appliedCfg.mode==='auto' && !complete){ $('sprinklerReason').textContent=`Otomatis ${basisName(appliedCfg)} diblokir: perlu ${appliedCfg.controlBasis==='thi' ? '6 DS + 4 DHT' : '6 DS'} valid/fresh.`; return; }
  // Web TIDAK pernah menjalankan kontrol otomatis atau auto-off sendiri.
  if (appliedCfg.mode === 'manual'){
    $('sprinklerReason').textContent = 'Mode manual · status mengikuti laporan relay ESP kanan.';
  } else {
    const value=metricValue(sensorView,appliedCfg), gated=appliedCfg.autoSrc==='schedule';
    $('sprinklerReason').textContent=`${basisName(appliedCfg)} ${fmtValue(value)}${basisUnit(appliedCfg)} · threshold ${appliedCfg.threshold.toFixed(1)}${basisUnit(appliedCfg)}. ${gated ? 'Hanya dalam slot jadwal, bukan paksa ON. ' : ''}Hysteresis, durasi maks, dan cooldown dijalankan ESP.`;
  }
}

// ---------- DATA MASUK (dari Firebase via ESP32) ----------
function onNewData(raw){
  telemetry = raw;
  refreshTelemetry();
  if (!raw || !sensorView.online || raw.ts === lastUpdate) return;
  lastUpdate = raw.ts;
  history.push({ t: lastUpdate, s: temps, h: humidities, avg:sensorView.avg, humidityAvg:sensorView.humidityAvg,thi:sensorView.thi });
  if (history.length > 1800) history = history.slice(-1800);
  localStorage.setItem('scs_hist', JSON.stringify(history.slice(-600)));
  drawChart();
}

// ---------- CHART (canvas murni, offline-friendly) ----------
function drawChart(){
  const c = $('chart'), ctx = c.getContext('2d');
  if (!c.clientWidth) return; // hidden until authenticated or chart page is shown
  const T = chartTheme();
  const W = c.width = c.clientWidth * 2, H = c.height = 440;
  ctx.clearRect(0,0,W,H);
  if (history.length < 2){
    ctx.strokeStyle=T.grid; ctx.lineWidth=1;
    for(let i=1;i<=4;i++){ const y=i*70; ctx.beginPath(); ctx.moveTo(24,y); ctx.lineTo(W-24,y); ctx.stroke(); }
    ctx.textAlign='center'; ctx.fillStyle=T.empty; ctx.font='500 26px Segoe UI, sans-serif';
    ctx.fillText('Tren dimulai dari pembacaan pertama.', W/2, 195);
    ctx.font='20px Segoe UI, sans-serif'; ctx.fillText('Menunggu data sensor terkini…', W/2, 235); ctx.textAlign='start'; return;
  }
  const data = history.filter((d) => Date.now() - d.t < 3600000).slice(-1800);
  if (data.length < 2) return;
  const rh = $('chartMetric').value === 'humidity';
  const thi=$('chartMetric').value==='thi';
  const threshold=profileOf(thi ? 'thi' : 'temperature').threshold;
  const values = (row) => thi ? [row.thi] : rh ? row.h || [] : row.s || [];
  let mn = 99, mx = -99;
  data.forEach(d=>{ values(d).filter(SCSTelemetry.finite).forEach(v=>{mn=Math.min(mn,v);mx=Math.max(mx,v);}); });
  if (rh){ mn = 0; mx = 100; }
  else { mn = Math.min(mn, threshold-2)-0.3; mx = Math.max(mx, threshold+2)+0.3; }
  const X = i => 60 + (data[i].t-data[0].t)/Math.max(1,data[data.length-1].t-data[0].t)*(W-80);
  const Y = v => 20 + (1-(v-mn)/(mx-mn))*(H-70);
  // grid + threshold
  ctx.strokeStyle=T.grid; ctx.fillStyle=T.txt; ctx.font='22px sans-serif';
  for(let k=0;k<=4;k++){ const v=mn+(mx-mn)*k/4, y=Y(v);
    ctx.beginPath(); ctx.moveTo(60,y); ctx.lineTo(W-20,y); ctx.stroke();
    ctx.fillText(v.toFixed(1)+(thi?'':rh?'%':'°'), 4, y+7); }
  if (!rh){
   const yT = Y(threshold);
  ctx.setLineDash([12,8]); ctx.strokeStyle=T.threshold; ctx.lineWidth=2;
  ctx.beginPath(); ctx.moveTo(60,yT); ctx.lineTo(W-20,yT); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle=T.threshold; ctx.fillText('ambang '+threshold.toFixed(1)+(thi?' THI':'°C'), 70, yT-10);
  }
  const draw = (idx, color, get) => {
    ctx.strokeStyle=color; ctx.lineWidth = idx==='avg'?5:2.5; ctx.beginPath();
    let drawing = false, previous = null;
    data.forEach((d,i)=>{
      const value = get(d);
      if (!SCSTelemetry.finite(value)){ drawing = false; return; }
      if (previous !== null && d.t - previous > 15000) drawing = false;
      const y = Y(value); drawing ? ctx.lineTo(X(i),y) : ctx.moveTo(X(i),y);
      drawing = true; previous = d.t;
    });
    ctx.stroke();
  };
  if(thi) draw('avg',T.thi,d=>d.thi);
  else {
    for(let s=0;s<(rh?4:6);s++) draw(s, COLORS[s]+'cc', d=>values(d)[s]);
    if ($('showAvg').checked) draw('avg', AVG_COLOR, d=>rh ? d.humidityAvg : d.avg);
  }
}
window.addEventListener('resize', drawChart);
$('showAvg').onchange = drawChart;
$('chartMetric').onchange = () => { renderLegend(); drawChart(); };
$('btnClearChart').onclick = ()=>{ history=[]; localStorage.removeItem('scs_hist'); drawChart(); };

// ---------- LOG 1 JAM ----------
function addLogRow(avg){
  if (!sensorView.online) return;
  const row = { t: telemetry.ts, s: temps.slice(), h: humidities.slice(), avg:sensorView.avg,
    humidityAvg:sensorView.humidityAvg,thi:sensorView.thi, spray: sprinklerOn?1:0 };
  logs.unshift(row); logs = logs.slice(0,120);
  localStorage.setItem('scs_logs', JSON.stringify(logs));
  renderLogs();
}
function renderLogs(){
  const f = $('filterSensor').value;
  const tb = $('logBody'); tb.innerHTML='';
  const valueOf=r=>appliedCfg.controlBasis==='thi' ? r.thi : r.avg;
  const rows = logs.filter(r => f==='all' ? true : SCSTelemetry.finite(valueOf(r)) && (f==='panas' ? valueOf(r)>=appliedCfg.threshold : valueOf(r)<appliedCfg.threshold));
  if (!rows.length){ tb.innerHTML = '<tr><td colspan="16" class="empty">Belum ada riwayat sensor untuk filter ini.</td></tr>'; }
  rows.forEach(r=>{
    const tr = document.createElement('tr');
    const time = new Date(r.t).toLocaleTimeString('id-ID',{timeZone:'Asia/Jakarta',hour:'2-digit',minute:'2-digit',second:'2-digit'});
    const value=valueOf(r), hot=SCSTelemetry.finite(value) && value>=appliedCfg.threshold;
    tr.innerHTML = `<td>${time}</td>` + Array.from({length:6},(_,i)=>`<td>${fmtValue(r.s?.[i])}</td>`).join('')
      + Array.from({length:4},(_,i)=>`<td>${fmtValue(r.h?.[i])}</td>`).join('')
      + `<td><b>${fmtValue(r.avg)}</b></td><td>${fmtValue(r.humidityAvg)}</td><td>${fmtValue(r.thi)}</td><td>${basisName(appliedCfg)}: ${!SCSTelemetry.finite(value)?'TIDAK VALID':hot?'≥ THRESHOLD':'< THRESHOLD'}</td><td>${r.spray?'💦 ON':'OFF'}</td>`;
    tb.appendChild(tr);
  });
  $('logCount').textContent = `${logs.length}/120 baris terbaru`;
}
$('filterSensor').onchange = renderLogs;
$('btnLogNow').onclick = ()=> addLogRow(sensorView.avg);
$('btnClearLog').onclick = async ()=>{
  if (await askConfirm('🗑 Hapus semua log?', 'Semua baris log di browser akan hilang. Data di Firebase tetap ada.')){
    logs=[]; localStorage.removeItem('scs_logs'); renderLogs();
  }
};
$('btnClearEvents').onclick = async ()=>{
  if (await askConfirm('🗑 Hapus semua event?', 'Semua event di browser akan hilang. Data di Firebase tetap ada.')){
    events=[]; localStorage.removeItem('scs_events'); renderEvents();
  }
};
// ---------- MODAL KONFIRMASI CUSTOM (pengganti confirm() bawaan, ikut tema) ----------
let confirmRes = null, confirmReturnFocus = null;
function askConfirm(title, msg){
  confirmReturnFocus = document.activeElement;
  $('confirmTitle').textContent = title || 'Yakin?';
  $('confirmMsg').textContent = msg || '';
  $('confirmOverlay').hidden = false;
  $('confirmNo').focus();
  return new Promise((res) => { confirmRes = res; });
}
function closeConfirm(v){
  $('confirmOverlay').hidden = true;
  if (confirmRes && confirmReturnFocus?.isConnected) confirmReturnFocus.focus();
  if (confirmRes){ const r = confirmRes; confirmRes = null; r(v); }
}
$('btnExport').onclick = ()=>{
  let csv = 'waktu_wib,ds1,ds2,ds3,ds4,ds5,ds6,dht1_rh,dht2_rh,dht3_rh,dht4_rh,avg_ds,avg_rh,thi,sprinkler\n';
  [...logs].reverse().forEach(r=>{
    const w = new Date(r.t).toLocaleString('id-ID',{timeZone:'Asia/Jakarta'});
    csv += `"${w}",` + [...Array.from({length:6},(_,i)=>r.s?.[i]),...Array.from({length:4},(_,i)=>r.h?.[i]),r.avg,r.humidityAvg,r.thi].map(v=>SCSTelemetry.finite(v)?v:'').join(',') + `,${r.spray?'ON':'OFF'}\n`;
  });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv],{type:'text/csv'}));
  a.download = 'smartcow-ds-dht.csv'; a.click(); URL.revokeObjectURL(a.href);
};

// ---------- EVENTS ----------
function pushEvent(msg){
  events.unshift({ t: Date.now(), msg }); events = events.slice(0,50);
  localStorage.setItem('scs_events', JSON.stringify(events));
  if (fbConnected && window.SCSFirebase) SCSFirebase.pushEvent(msg).catch(()=>{});
  renderEvents();
}
function renderEvents(){
  const ul = $('eventList'); ul.innerHTML = events.length?'':'<li class="hint">Belum ada event.</li>';
  events.forEach(e=>{
    const li = document.createElement('li');
    const text = document.createElement('div'); text.textContent = e.msg;
    const stamp = document.createElement('div'); stamp.className='t'; stamp.textContent = new Date(e.t).toLocaleString('id-ID',{timeZone:'Asia/Jakarta'})+' WIB';
    li.append(text, stamp);
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
function pad2(n){ return String(n).padStart(2, '0'); }
// "HH:MM" WIB untuk nowMs+offset (batas bawah jam hari ini).
function wibHMplus(offsetMs){
  const t = new Date(Date.now() + (offsetMs || 0));
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(t);
  const g = (x) => p.find((y) => y.type === x).value;
  return `${pad2((+g('hour')) % 24)}:${g('minute')}`;
}
// Kalau tanggal = hari ini, jam otomatis naik ke sekarang+1 mnt (min). Besok/besoknya bebas.
function clampToday(iso, hm){
  if (iso !== SCS.wibDateStr()) return hm;
  const min = wibHMplus(60000);
  return hm < min ? min : hm;
}
// ---------- EDITOR DAFTAR JADWAL (maks 6 slot bertanggal) ----------
// Aturan: tanggal bebas (min hari ini). Khusus hari ini, jam min = sekarang+1 mnt.
function renderSchedList(){
  const box = $('schedList'); if (!box) return;
  const locked = CFG.mode !== 'auto' || !fbConnected || !controlLoaded || !transportConnected || savingSettings;
  box.innerHTML = '';
  const slots = schedSlots();
  if (!slots.length){
    box.innerHTML = '<div class="hint" style="padding:4px 2px">Belum ada jadwal — klik ＋ Tambah.</div>';
  }
  slots.forEach((s, i) => {
    const f = SCS.formatIDDate(s.date);
    const row = document.createElement('div');
    row.className = 'sched-row';
    row.innerHTML = `<span class="sched-num">${i + 1}</span>
      <div class="sched-groups">
        <button class="pick-btn" data-pick="date" data-i="${i}" data-pop-anchor ${locked ? 'disabled' : ''} title="Pilih tanggal"><span class="pick-ico">📅</span><span>${f || s.date}</span></button>
        <button class="pick-btn" data-pick="time" data-i="${i}" data-pop-anchor ${locked ? 'disabled' : ''} title="Pilih jam (24 jam)"><span class="pick-ico">🕐</span><span>${s.start}</span></button>
        <div class="sched-group"><span>Lebar jendela jadwal</span><div class="sched-inline step">
          <button data-dec="${i}" title="Kurangi 1 menit" ${locked ? 'disabled' : ''}>−</button><b data-durv="${i}">${s.dur}</b><button data-inc="${i}" title="Tambah 1 menit" ${locked ? 'disabled' : ''}>+</button><i>mnt</i>
        </div></div>
      </div>
      <button class="btn red small sched-del" data-del="${i}" title="Hapus jadwal ini" ${locked ? 'disabled' : ''}>✕</button>`;
    box.appendChild(row);
  });
  box.querySelectorAll('[data-pick]').forEach((b) => {
    b.onclick = (e) => { e.stopPropagation(); openSlotPicker(b); };
  });
  function stepDur(i, d){
    const arr = [...schedSlots()];
    if (!arr[i]) return;
    arr[i].dur = Math.min(180, Math.max(1, arr[i].dur + d));
    CFG.schedules = arr; markSettingsDirty();
    const b = box.querySelector(`[data-durv="${i}"]`);
    if (b) b.textContent = arr[i].dur;
    updateSchedHint(); updateModeInfo();
  }
  function holdStep(btn, fn){
    const start = (e) => {
      e.preventDefault();
      fn();
      const t1 = setTimeout(() => {
        const iv = setInterval(fn, 80);
        btn._stop = () => { clearTimeout(t1); clearInterval(iv); };
      }, 400);
      btn._t1 = t1;
    };
    const stop = () => { clearTimeout(btn._t1); if (btn._stop) btn._stop(); };
    btn.addEventListener('pointerdown', start);
    ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => btn.addEventListener(ev, stop));
  }
  box.querySelectorAll('[data-inc]').forEach((b) => holdStep(b, () => stepDur(+b.dataset.inc, 1)));
  box.querySelectorAll('[data-dec]').forEach((b) => holdStep(b, () => stepDur(+b.dataset.dec, -1)));
  box.querySelectorAll('[data-del]').forEach((btn) => {
    btn.onclick = () => {
      const cur = readSchedList(true);
      cur.splice(+btn.dataset.del, 1);
      CFG.schedules = cur; // boleh kosong, tidak respawn
      markSettingsDirty(); syncButtons();
    };
  });
  const add = $('btnAddSched'); if (add) add.disabled = locked || schedSlots().length >= 6;
}
function readSchedList(keepPast){
  // Nilai jadwal hidup di CFG.schedules (popup menulis langsung ke sana).
  // Fungsi ini normalisasi: dedupe + buang yang lewat + urut + batasi 6. Boleh kosong.
  const now = Date.now();
  const out = [];
  schedSlots().forEach((s) => {
    if (out.some((o) => o.date === s.date && o.start === s.start)) return;
    if (!keepPast && SCS.slotState(s, now) === 'past') return; // yang sudah lewat dibuang
    out.push(s);
  });
  return out.slice(0, 6);
}
// ---------- POPUP PICKER CUSTOM (kalender + jam 24, ikut tema) ----------
let popEl = null;
function closePicker(){
  if (!popEl) return;
  popEl.remove(); popEl = null;
  document.removeEventListener('pointerdown', popOutside, true);
  window.removeEventListener('scroll', closePicker, true);
  window.removeEventListener('resize', closePicker);
  document.removeEventListener('keydown', popEsc);
}
function popOutside(e){
  if (!popEl) return;
  if (e.target.closest && e.target.closest('[data-pop-anchor]')) return; // biar toggle anchor yang urus
  if (!popEl.contains(e.target)) closePicker();
}
function popEsc(e){ if (e.key === 'Escape') closePicker(); }
function openPop(anchor, key, html){
  if (popEl && popEl.dataset.for === key){ closePicker(); return null; } // toggle
  closePicker();
  popEl = document.createElement('div');
  popEl.className = 'picker-pop';
  popEl.dataset.for = key;
  popEl.innerHTML = html;
  document.body.appendChild(popEl);
  placePop(anchor);
  document.addEventListener('pointerdown', popOutside, true);
  window.addEventListener('scroll', closePicker, true);
  window.addEventListener('resize', closePicker);
  document.addEventListener('keydown', popEsc);
  return popEl;
}
// Ukur ulang + posisikan popup: bawah dulu, flip ke atas kalau tidak muat (biar tidak ketutup taskbar).
function placePop(anchor){
  if (!popEl || !anchor) return;
  popEl.style.visibility = 'hidden';
  const r = anchor.getBoundingClientRect();
  const pw = popEl.offsetWidth, ph = popEl.offsetHeight;
  const x = Math.min(r.left, window.innerWidth - pw - 12);
  let y = r.bottom + 6;
  if (y + ph > window.innerHeight - 12) y = r.top - ph - 6;
  if (y < 12) y = Math.max(12, Math.min(r.bottom + 6, window.innerHeight - ph - 12));
  popEl.style.left = Math.max(12, x) + 'px';
  popEl.style.top = Math.max(0, y) + 'px';
  popEl.style.visibility = '';
}
const ID_MON = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
const ID_DOW = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'];
function openSlotPicker(btn){
  const i = +btn.dataset.i, type = btn.dataset.pick;
  const slots = [...schedSlots()];
  const s = slots[i];
  if (!s) return;
  if (type === 'date') openDatePop(btn, i, s);
  else openTimePop(btn, i, s);
}
function commitSlots(slots, msg){
  CFG.schedules = slots.slice(0, 6);
  markSettingsDirty(); syncButtons(); updateSchedHint();
}
// --- Kalender popup: min hari ini, maks 31 Des 2030 ---
function openDatePop(btn, i, s){
  const today = SCS.wibDateStr();
  const cur = /^\d{4}-\d{2}-\d{2}$/.test(s.date) ? s.date : today;
  let vy = +cur.slice(0, 4), vm = +cur.slice(5, 7);
  const el = openPop(btn, i + '-date', '<div class="pk-cal"></div>');
  if (!el) return;
  const box = el.querySelector('.pk-cal');
  function draw(){
    const first = new Date(Date.UTC(vy, vm - 1, 1));
    const lead = (first.getUTCDay() + 6) % 7; // Senin=0
    const dim = new Date(Date.UTC(vy, vm, 0)).getUTCDate();
    let h = `<div class="pk-head"><button data-nav="-1"${vy === 2026 && vm === 1 ? ' disabled' : ''}>‹</button><b>${ID_MON[vm - 1]} ${vy}</b><button data-nav="1"${vy === 2030 && vm === 12 ? ' disabled' : ''}>›</button></div>`;
    h += '<div class="pk-dow">' + ID_DOW.map((d) => `<span>${d}</span>`).join('') + '</div><div class="pk-grid">';
    for (let k = 0; k < lead; k++) h += '<span></span>';
    for (let d = 1; d <= dim; d++){
      const iso = `${vy}-${pad2(vm)}-${pad2(d)}`;
      const dis = iso < today || iso > '2030-12-31';
      h += `<button data-day="${iso}"${dis ? ' disabled' : ''} class="${iso === s.date ? 'sel' : ''}">${d}</button>`;
    }
    h += '</div><div class="pk-foot"><button data-today>Hari ini</button><button data-close>Tutup</button></div>';
    box.innerHTML = h;
    box.querySelectorAll('[data-nav]').forEach((b) => {
      b.onclick = () => {
        vm += +b.dataset.nav;
        if (vm < 1){ vm = 12; vy--; } if (vm > 12){ vm = 1; vy++; }
        if (vy < 2026 || (vy === 2026 && vm < 1)){ vy = 2026; vm = 1; }
        if (vy > 2030 || (vy === 2030 && vm > 12)){ vy = 2030; vm = 12; }
        draw();
      };
    });
    box.querySelectorAll('[data-day]').forEach((b) => {
      b.onclick = () => {
        const arr = [...schedSlots()];
        if (!arr[i]){ closePicker(); return; }
        const day = b.dataset.day;
        arr[i] = { ...arr[i], date: day, start: clampToday(day, arr[i].start) };
        commitSlots(arr);
        closePicker();
      };
    });
    box.querySelector('[data-today]').onclick = () => {
      const arr = [...schedSlots()];
      if (!arr[i]){ closePicker(); return; }
      const day = SCS.wibDateStr();
      arr[i] = { ...arr[i], date: day, start: clampToday(day, arr[i].start) };
      commitSlots(arr);
      closePicker();
    };
    box.querySelector('[data-close]').onclick = closePicker;
    placePop(btn); // ukur ulang setelah isi kalender ada (tinggi beda tiap bulan)
  }
  draw();
}
// --- Jam popup: 24 jam (00-23) + menit, arrow atas-bawah (tahan = repeat) ---
function openTimePop(btn, i, s){
  const today = SCS.wibDateStr();
  let curDate = /^\d{4}-\d{2}-\d{2}$/.test(s.date) ? s.date : today;
  // Batas bawah khusus slot hari ini: sekarang+1 mnt (slot besok bebas 00:00).
  let minH = -1, minM = 0;
  function refreshMin(){
    if (curDate <= today){
      const t = new Date(Date.now() + 60000);
      const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(t);
      const g = (x) => p.find((y) => y.type === x).value;
      minH = (+g('hour')) % 24; minM = +g('minute');
    } else { minH = -1; minM = 0; }
  }
  function addDays(iso, n){
    const p = iso.split('-').map(Number);
    return new Date(Date.UTC(p[0], p[1] - 1, p[2]) + n * 86400000).toISOString().slice(0, 10);
  }
  const parts = (s.start || '09:00').split(':');
  let hh = Math.min(23, Math.max(0, parseInt(parts[0]) || 0));
  let mi = Math.min(59, Math.max(0, parseInt(parts[1]) || 0));
  refreshMin();
  if (hh < minH || (hh === minH && mi < minM)){ hh = minH; mi = minM; }
  const el = openPop(btn, i + '-time', `<div class="pk-date" data-v="date"></div><div class="pk-time">
      <div class="pk-col"><button data-s="h" data-d="1">▲</button><input data-v="h" value="${pad2(hh)}" inputmode="numeric" maxlength="2" autocomplete="off" /><button data-s="h" data-d="-1">▼</button><span>Jam</span></div>
      <div class="pk-sep">:</div>
      <div class="pk-col"><button data-s="m" data-d="1">▲</button><input data-v="m" value="${pad2(mi)}" inputmode="numeric" maxlength="2" autocomplete="off" /><button data-s="m" data-d="-1">▼</button><span>Menit</span></div>
    </div>
    <div class="pk-foot"><span class="hint">24 jam • WIB</span><span><button data-close>Batal</button> <button data-ok class="btn blue small">OK</button></span></div>`);
  if (!el) return;
  const vH = el.querySelector('[data-v="h"]'), vM = el.querySelector('[data-v="m"]'), vD = el.querySelector('[data-v="date"]');
  function paintDate(){ if (vD) vD.textContent = SCS.formatIDDate(curDate) || curDate; }
  function paint(){ if (document.activeElement !== vH) vH.value = pad2(hh); if (document.activeElement !== vM) vM.value = pad2(mi); paintDate(); }
  // Geser jam + rollover tanggal: 23:59 +1 -> 00:00 besok; 00:00 -1 -> 23:xx kemarin (min. hari ini).
  function rollHour(d){
    if (d > 0){
      if (hh >= 23){
        const nx = addDays(curDate, 1);
        if (nx <= '2030-12-31'){ curDate = nx; hh = 0; }
      } else hh++;
    } else {
      if (hh <= 0){
        const pv = addDays(curDate, -1);
        if (pv >= today){ curDate = pv; hh = 23; }
      } else hh--;
    }
    refreshMin();
  }
  function step(which, d){
    if (which === 'h') rollHour(d);
    else {
      mi += d;
      if (mi > 59){ mi = 0; rollHour(1); }
      else if (mi < 0){ mi = 59; rollHour(-1); }
    }
    if (minH >= 0 && (hh < minH || (hh === minH && mi < minM))){ hh = minH; mi = minM; }
    paint();
  }
  // Ketik langsung: cuma digit, clamp 0-23 / 0-59 + batas bawah slot hari ini.
  function readInputs(){
    let h = parseInt((vH.value || '').replace(/\D/g, '').slice(-2), 10);
    let m = parseInt((vM.value || '').replace(/\D/g, '').slice(-2), 10);
    if (!isFinite(h)) h = hh; if (!isFinite(m)) m = mi;
    h = Math.min(23, Math.max(0, h)); m = Math.min(59, Math.max(0, m));
    if (h < minH || (h === minH && m < minM)){ h = minH; m = minM; }
    hh = h; mi = m; paint();
  }
  vH.addEventListener('change', readInputs);
  vM.addEventListener('change', readInputs);
  let repT = null, repI = null;
  function stopRep(){ clearTimeout(repT); clearInterval(repI); repT = repI = null; }
  el.querySelectorAll('[data-s]').forEach((b) => {
    const w = b.dataset.s, d = +b.dataset.d;
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      step(w, d);
      stopRep();
      repT = setTimeout(() => { repI = setInterval(() => step(w, d), 70); }, 380);
    });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => b.addEventListener(ev, stopRep));
    b.addEventListener('click', stopRep);
  });
  el.querySelector('[data-close]').onclick = () => { stopRep(); closePicker(); };
  el.querySelector('[data-ok]').onclick = () => {
    stopRep();
    readInputs(); // pastikan ketikan terakhir ikut ke-commit
    const arr = [...schedSlots()];
    if (!arr[i]){ closePicker(); return; }
    arr[i] = { ...arr[i], date: curDate, start: pad2(hh) + ':' + pad2(mi) };
    commitSlots(arr);
    closePicker();
  };
}
function syncButtons(){
  if (typeof closePicker === 'function') closePicker(); // anchor lama bisa hilang pas re-render
  $('btnAuto').classList.toggle('active', CFG.mode==='auto');
  $('btnManual').classList.toggle('active', CFG.mode==='manual');
  $('btnSprayOn').disabled = $('btnSprayOff').disabled = CFG.mode!=='manual' || !controlLoaded || !fbConnected || !sensorView.online || !transportConnected;
  $('btnManual').disabled = !fbConnected || !controlLoaded || !transportConnected || !sensorView.online || savingSettings;
  $('btnAuto').disabled = $('btnManual').disabled || !firmwareReady();
  const locked = CFG.mode !== 'auto' || !fbConnected || !controlLoaded || !transportConnected || savingSettings;
  const src = curAutoSrc();
  const isThresh = src === 'threshold';
  $('srcThreshold').checked = isThresh;
  $('srcSchedule').checked = !isThresh;
  $('srcThreshold').disabled = $('srcSchedule').disabled = locked;
  $('basisTemperature').checked=CFG.controlBasis==='temperature'; $('basisThi').checked=CFG.controlBasis==='thi';
  $('basisTemperature').disabled=$('basisThi').disabled=locked;
  ['inThreshold','rangeThreshold','inHysteresis','inMaxDur','inCooldown'].forEach((id)=>{ $(id).disabled = locked; });
  $('btnSaveCfg').disabled = locked || !firmwareReady();
  $('btnSaveCfg').textContent = savingSettings ? 'Menyimpan pengaturan…' : !fbConnected ? 'Login untuk mengatur' : !controlLoaded ? 'Menunggu konfigurasi perangkat' : locked ? 'Pengaturan terkunci' : 'Simpan Pengaturan';
  $('btnSaveCfg').setAttribute('aria-busy', String(savingSettings));
  const thi=CFG.controlBasis==='thi';
  for(const id of ['inThreshold','rangeThreshold']){ $(id).min=thi ? 0 : -55; $(id).max=thi ? 120 : 125; $(id).value=CFG.threshold; }
  $('inHysteresis').value=CFG.hysteresis;
  $('thresholdInputLabel').textContent=`Threshold semprot ${basisName(CFG)}${thi ? ' (indeks)' : ' (°C)'}`;
  $('hysteresisInputLabel').textContent=`Hysteresis (${thi ? 'poin THI' : '°C'})`;
  $('scheduleTitle').textContent=`Jendela jadwal ${basisName(CFG)} (maks 6×)`;
  $('controlBasisHint').textContent=`Profil ${basisName(CFG)}: threshold, hysteresis, durasi/cooldown dan jadwal sendiri. ${thi ? 'THI dari rata-rata 6 DS + RH rata-rata 4 DHT.' : 'DHT tidak wajib untuk kontrol suhu.'} Klik Simpan untuk menerapkan.`;
  $('inMaxDur').value = CFG.maxDuration; $('inCooldown').value = CFG.cooldown;
  // Jadwal tetap memakai threshold serta seluruh proteksi profil terpilih.
  $('threshGroup').style.display = '';
  $('protectGroup').style.display = '';
  $('schedGroup').style.display = isThresh ? 'none' : '';
  renderSchedList();
  updateSchedHint();
  updateModeInfo();
}
async function setMode(mode){
  if (!fbConnected || !controlLoaded || !transportConnected || !sensorView.online || (mode==='auto' && !firmwareReady())){
    $('settingsStatus').textContent='Perangkat harus online dengan firmware kanan v3.1 sebelum mengaktifkan otomatis.'; return;
  }
  try { await SCSFirebase.pushControl({mode}); CFG.mode=mode; saveCfg(); syncButtons(); }
  catch { $('settingsStatus').textContent='Perubahan mode gagal dikirim.'; }
}
$('btnAuto').onclick = ()=>setMode('auto');
$('btnManual').onclick = ()=>setMode('manual');
$('btnSprayOn').onclick = ()=> setSprinkler(true, 'tombol manual');
$('btnSprayOff').onclick = ()=> setSprinkler(false, 'tombol manual');
async function fbPushControl(){
  if (!fbConnected || !controlLoaded || !transportConnected || !firmwareReady() || !window.SCSFirebase){
    $('settingsStatus').textContent='Belum dikirim: login, koneksi, dan firmware kanan v3.1 harus siap.'; return;
  }
  const submitted=SCSControl.normalize(SCSControl.capture(CFG));
  savingSettings=true; syncButtons();
  try {
    await SCSFirebase.pushControl(SCSControl.toFirebase(submitted));
    appliedCfg=submitted; CFG=SCSControl.normalize(submitted); settingsDirty=false; saveCfg();
    $('settingsStatus').textContent=`Profil ${basisName(submitted)} tersimpan di Firebase; ESP membaca setting sekitar tiap 5 detik.`;
    pushEvent(`Setting ${basisName(submitted)}: threshold ${submitted.threshold}${basisUnit(submitted)}, ${submitted.autoSrc==='schedule' ? 'dalam jadwal' : 'sepanjang waktu'}`);
  } catch {
    CFG=SCSControl.normalize(submitted); settingsDirty=true; saveCfg();
    $('settingsStatus').textContent='Gagal menyimpan. Perubahan masih berupa draft; coba lagi.';
  }
  finally { savingSettings=false; syncButtons(); refreshTelemetry(); drawChart(); }
}
// Info kecil: lagi pake mode apa + ringkasannya.
function updateModeInfo(){
  const el = $('modeInfo'); if (!el) return;
  const cfg=appliedCfg;
  if (cfg.mode !== 'auto'){
    el.textContent = 'Manual: ON bertahan sampai perintah OFF, termasuk saat internet putus. Uji tanpa beban AC dahulu.';
    return;
  }
  el.textContent=`${basisName(cfg)} ≥ ${cfg.threshold.toFixed(1)}${basisUnit(cfg)} · ${cfg.autoSrc==='schedule' ? 'hanya dalam jadwal' : 'sepanjang waktu'} · maks ${cfg.maxDuration} dtk, cooldown ${cfg.cooldown} dtk. Data tidak lengkap → otomatis OFF.`;
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
  const daftar = slots.map((s) => SCS.formatIDSlot(s)).join(', ');
  el.textContent = `${basisName(CFG)} · ${slots.length} jendela: ${daftar}. ` + (run ? 'JENDELA AKTIF, bukan paksa ON. ' : (nx ? `Berikutnya ${SCS.formatIDSlot(nx)}. ` : '')) + `Tetap mengikuti threshold ${CFG.threshold}${basisUnit(CFG)}, hysteresis, durasi maks dan cooldown.`;
}
let fbTries = 0;
// fbStatus hanya tampil saat belum live (sim/error) biar tampilan clean.
function setFbStatus(msg, kind){
  const el = $('fbStatus'); if (!el) return;
  el.textContent = msg || '';
  el.dataset.kind = kind || 'login';
  const notice=$('connectionNotice');
  notice.textContent=kind==='err' && fbConnected ? msg : '';
  notice.hidden=!notice.textContent;
}
// The shell is never exposed before Firebase confirms an authenticated session.
function accountNameOf(email){
  if (typeof email !== 'string') return 'Pengelola';
  const at=email.indexOf('@');
  return at > 0 ? email.slice(0,at).trim() || 'Pengelola' : 'Pengelola';
}
function setAuthView(ok, email=''){
  if (!ok){ closeSide(); closePicker(); closeConfirm(false); }
  $('appShell').hidden=!ok;
  $('appShell').inert=!ok;
  $('authPanel').hidden=ok;
  $('btnLogout').hidden=!ok;
  $('accountEmail').textContent=ok ? email || 'Akun terautentikasi' : 'Akun terautentikasi';
  const name=ok ? accountNameOf(email) : 'Pengelola';
  $('greetingName').textContent=name;
  $('accountName').textContent=name;
  $('accountName').title=name;
  const initial=Array.from(name)[0].toUpperCase();
  $('accountAvatar').textContent=initial;
  const avatar=document.querySelector('.topbar-avatar');
  avatar.textContent=initial;
  avatar.setAttribute('aria-label', `Akun ${name}`);
  if (ok){
    let page='dash';
    try { page=localStorage.getItem('scs_page') || 'dash'; } catch {}
    showPage(page);
    requestAnimationFrame(drawChart);
    $('mainContent').focus({preventScroll:true});
  } else {
    document.title='Masuk — SmartCow';
    $('connectionNotice').hidden=true;
    $('loginPassword').value='';
    $('loginPassword').type='password';
    $('togglePassword').setAttribute('aria-pressed','false');
    $('togglePassword').setAttribute('aria-label','Tampilkan password');
    $('loginEmail').focus({preventScroll:true});
  }
}
function fbConnect(){
  $('btnLogin').disabled=true;
  if (!window.SCSFirebase){ // module SDK belum termuat, coba lagi sebentar
    fbTries++;
    setFbStatus(fbTries > 12
      ? 'SDK login belum termuat. Periksa internet dan akses gstatic.com, lalu muat ulang. Untuk preview lokal, gunakan http://localhost, bukan file://.'
      : 'Memuat Firebase SDK…', 'sim');
    setTimeout(()=>{ if (!fbConnected) fbConnect(); }, 800);
    return;
  }
  setFbStatus('Menghubungkan ke Firebase…', 'sim');
  SCSFirebase.connect({
    onStatus: (msg, kind)=>{ setFbStatus(msg, kind); setConn(kind); },
    onTransport: (online)=>{ transportConnected=online; syncButtons(); refreshTelemetry(); },
    onAuth: (ok, email)=>{
      fbConnected=ok;
      $('btnLogin').disabled=false;
      setAuthView(ok, email);
      if (!ok){ controlLoaded=false; settingsDirty=false; telemetry=null; transportConnected=false; lastUpdate=null; history=[]; logs=[]; events=[]; sprinklerOn=false; sprayStart=null; renderLogs(); renderEvents(); drawChart(); }
      setFbStatus(ok ? '' : 'Masuk dengan akun Firebase yang sudah ada.', 'login'); syncButtons(); refreshTelemetry();
    },
    onControl: (ctl)=>{
      if (!fbConnected) return;
      if (!ctl){ controlLoaded=false; syncButtons(); return; }
      controlLoaded=true;
      appliedCfg=SCSControl.fromFirebase(ctl);
      if (!settingsDirty && !savingSettings) CFG=SCSControl.normalize(appliedCfg);
      else CFG.mode=appliedCfg.mode;
      saveCfg(); syncButtons(); refreshTelemetry(); renderLogs();
    },
    onTelemetry: (p)=>{
      if (!fbConnected) return;
      onNewData(p);
      if (sensorView.ssr !== null){
        const changed=(sensorView.ssr===1)!==sprinklerOn;
        sprinklerOn=sensorView.ssr===1;
        if (changed) sprayStart=sprinklerOn?Date.now():null;
        renderSprinkler();
      }
    },
    onSeedLogs: (rows)=>{ if (!fbConnected) return; logs = SCS.pruneLogs(rows, 120); localStorage.setItem('scs_logs', JSON.stringify(logs)); renderLogs(); },
    onEvents: (rows)=>{ if (!fbConnected) return; events=rows; renderEvents(); }
  })
    .catch((e)=>{ setFbStatus('Firebase: ' + e.message, 'err'); setConn('err'); });
}
function setConn(kind){
  const b = $('connBadge');
  if (kind==='sim'){ b.textContent='● MENGHUBUNGKAN'; b.className='badge sim'; }
  if (kind==='live'){ b.textContent='● LIVE ESP32'; b.className='badge live'; }
  if (kind==='err'){ b.textContent='● KONEKSI GAGAL'; b.className='badge err'; }
  if (kind==='offline'){ b.textContent='● ESP OFFLINE / DATA LAMA'; b.className='badge offline'; }
  if (kind==='login'){ b.textContent='● PERLU LOGIN'; b.className='badge sim'; }
}

$('loginForm').onsubmit = async (e)=>{
  e.preventDefault(); $('btnLogin').disabled=true; $('btnLogin').setAttribute('aria-busy','true'); $('loginButtonText').textContent='Memeriksa akun…'; setFbStatus('Memeriksa akun…','login');
  try { await SCSFirebase.login($('loginEmail').value.trim(),$('loginPassword').value); $('loginPassword').value=''; }
  catch { setFbStatus('Login gagal. Periksa email/password dan koneksi internet.','err'); }
  finally { $('btnLogin').disabled=false; $('btnLogin').setAttribute('aria-busy','false'); $('loginButtonText').textContent='Masuk ke dashboard'; }
};
$('togglePassword').onclick=()=>{
  const show=$('loginPassword').type==='password';
  $('loginPassword').type=show ? 'text' : 'password';
  $('togglePassword').setAttribute('aria-pressed', String(show));
  $('togglePassword').setAttribute('aria-label', show ? 'Sembunyikan password' : 'Tampilkan password');
};
$('btnLogout').onclick=async()=>{
  $('btnLogout').disabled=true;
  try { await SCSFirebase.logout(); }
  catch { setFbStatus('Gagal keluar. Periksa koneksi dan coba lagi.', 'err'); }
  finally { $('btnLogout').disabled=false; }
};

// ---------- SETTINGS ----------
function readSettingsInputs(){
  const fields=[['inThreshold','threshold',CFG.controlBasis==='thi' ? 0 : -55,CFG.controlBasis==='thi' ? 120 : 125],
    ['inHysteresis','hysteresis',0,50],['inMaxDur','maxDuration',1,10800],['inCooldown','cooldown',0,10800]];
  for(const [id,key,min,max] of fields){
    const value=Number($(id).value);
    if($(id).value.trim() && Number.isFinite(value)){
      const bounded=Math.max(min,Math.min(max,value));
      CFG[key]=key==='maxDuration' || key==='cooldown' ? Math.round(bounded) : bounded;
    }
  }
}
$('rangeThreshold').oninput = e => { $('inThreshold').value = e.target.value; readSettingsInputs(); markSettingsDirty(); };
$('inThreshold').oninput = e => { $('rangeThreshold').value = e.target.value; readSettingsInputs(); markSettingsDirty(); };
for(const id of ['inHysteresis','inMaxDur','inCooldown']) $(id).oninput=()=>{readSettingsInputs();markSettingsDirty();};
function changeBasis(basis){ readSettingsInputs(); CFG=SCSControl.selectBasis(CFG,basis); markSettingsDirty(); syncButtons(); }
$('basisTemperature').onchange=()=>changeBasis('temperature');
$('basisThi').onchange=()=>changeBasis('thi');
$('srcThreshold').onchange = () => { readSettingsInputs(); CFG.autoSrc = 'threshold'; markSettingsDirty(); syncButtons(); };
$('srcSchedule').onchange = () => { readSettingsInputs(); CFG.autoSrc = 'schedule'; markSettingsDirty(); syncButtons(); };
$('btnSaveCfg').onclick = ()=>{
  CFG.autoSrc = $('srcSchedule').checked ? 'schedule' : 'threshold';
  readSettingsInputs();
  CFG.schedules = readSchedList();
  saveCfg(); syncButtons(); renderSensors(); drawChart();
  fbPushControl();
};
$('btnAddSched').onclick = ()=>{
  const cur = readSchedList(true);
  if (cur.length >= 6) return;
  let ndate, ns;
  if (!cur.length){
    // Daftar kosong -> besok 09:00 (bebas diubah).
    const t = SCS.wibDateStr(), p = t.split('-').map(Number);
    ndate = new Date(Date.UTC(p[0], p[1] - 1, p[2]) + 86400000).toISOString().slice(0, 10);
    ns = '09:00';
  } else {
    // Slot baru = 60 mnt setelah slot terakhir; lewat tengah malam -> tanggal maju 1 hari.
    const last = cur[cur.length - 1];
    const h = SCS.hmToMin(last.start);
    const nh = isFinite(h) ? (h + 60) % 1440 : 9 * 60;
    ndate = last.date;
    if (isFinite(h) && nh <= h){
      const p = last.date.split('-').map(Number);
      ndate = new Date(Date.UTC(p[0], p[1] - 1, p[2]) + 86400000).toISOString().slice(0, 10);
    }
    ns = `${String(Math.floor(nh / 60)).padStart(2, '0')}:${String(nh % 60).padStart(2, '0')}`;
  }
  CFG.schedules = [...cur, { date: ndate, start: ns, dur: 10 }];
  markSettingsDirty(); syncButtons();
};

// ---------- SIDEBAR DRAWER + HALAMAN (dashboard / log / event) ----------
// Animasi clean: tanpa display:none (pakai visibility di CSS) biar transisi
// geser + fade overlay jalan mulus dua arah. Body dikunci scroll pas terbuka.
function setSide(open){
  open=!!open && fbConnected && window.matchMedia('(max-width: 980px)').matches;
  var sb = $('sidebar'); if (!sb) return;
  const wasOpen=sb.classList.contains('open');
  try { sb.style.display = ''; } catch {}
  sb.classList.toggle('open', !!open);
  const desktop=window.matchMedia('(min-width: 981px)').matches;
  sb.setAttribute('aria-hidden', open || desktop ? 'false' : 'true');
  sb.inert=!desktop && !open;
  $('menuBtn').setAttribute('aria-expanded',String(!!open));
  var ov = $('sideOverlay');
  if (ov){
    if (open){ ov.hidden = false; void ov.offsetWidth; ov.classList.add('show'); }
    else {
      ov.classList.remove('show');
      setTimeout(function(){ if (!$('sidebar').classList.contains('open')) ov.hidden = true; }, 340);
    }
  }
  try { document.body.style.overflow = open ? 'hidden' : ''; } catch {}
  if (open && !wasOpen) $('sideClose').focus();
}
function openSide(){ setSide(true); }
function closeSide(){ const wasOpen=$('sidebar').classList.contains('open'); setSide(false); if(wasOpen && fbConnected) $('menuBtn').focus(); }
function showPage(p){
  if (p !== 'log' && p !== 'event') p = 'dash';
  document.querySelectorAll('main.container > section').forEach((s) => {
    var show = (!s.dataset.page || s.dataset.page === p);
    if (show){
      s.style.display = '';
      // fade-in halus tiap ganti halaman (re-trigger paksa biar animasi jalan tiap klik)
      s.classList.remove('page-in');
      void s.offsetWidth;
      s.classList.add('page-in');
    } else {
      s.classList.remove('page-in');
      s.style.display = 'none';
    }
  });
  document.querySelectorAll('.side-link').forEach((b) => { b.classList.toggle('active', b.dataset.page === p); if(b.dataset.page===p) b.setAttribute('aria-current','page'); else b.removeAttribute('aria-current'); });
  $('pageBreadcrumb').textContent = {dash:'Overview', log:'Riwayat sensor', event:'Aktivitas sprinkler'}[p];
  document.title = `${$('pageBreadcrumb').textContent} — SmartCow`;
  try { localStorage.setItem('scs_page', p); } catch {}
  closeSide();
  window.scrollTo(0, 0);
  if(fbConnected) $('mainContent').focus({preventScroll:true});
  if (p === 'dash' && typeof drawChart === 'function') drawChart(); // canvas butuh redraw pas tampil lagi
}
// ---------- INIT (sumber tunggal: Firebase) ----------
applyTheme(curTheme());
$('themeBtn').onclick = ()=> applyTheme(curTheme() === 'light' ? 'dark' : 'light');
$('menuBtn').addEventListener('click', openSide);
$('sideClose').addEventListener('click', (e) => { e.stopPropagation(); closeSide(); });
$('sideOverlay').addEventListener('click', closeSide);
// Pengaman lapis dua: delegasi klik untuk tombol tutup.
document.addEventListener('click', (e) => {
  if (e.target && e.target.closest && e.target.closest('#sideClose')) closeSide();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape'){ closeSide(); closeConfirm(false); closePicker(); }
  if (e.key === 'Tab'){
    const modal = !$('confirmOverlay').hidden ? $('confirmOverlay') : $('sidebar').classList.contains('open') ? $('sidebar') : null;
    if (!modal) return;
    const focusable=[...modal.querySelectorAll('button:not(:disabled), a[href], input:not(:disabled)')].filter(el=>el.getClientRects().length);
    const first=focusable[0], last=focusable.at(-1);
    if(e.shiftKey && document.activeElement===first){ e.preventDefault(); last.focus(); }
    else if(!e.shiftKey && document.activeElement===last){ e.preventDefault(); first.focus(); }
  }
});
$('confirmYes').onclick = () => closeConfirm(true);
$('confirmNo').onclick = () => closeConfirm(false);
$('confirmOverlay').addEventListener('pointerdown', (e) => { if (e.target === $('confirmOverlay')) closeConfirm(false); });
document.querySelectorAll('.side-link').forEach((b) => { b.addEventListener('click', () => showPage(b.dataset.page)); });
history=[]; logs=[]; events=[]; // tidak menyajikan cache lama sebagai data live sebelum login
buildGrid(6); buildHumidityGrid(); buildLogHead(6); syncButtons(); renderSensors(); renderLogs(); renderEvents(); drawChart(); renderSprinkler();
try { showPage(localStorage.getItem('scs_page') || 'dash'); } catch { showPage('dash'); }
document.title='Masuk — SmartCow';
$('localPreviewNotice').hidden=!['localhost','127.0.0.1','::1','[::1]'].includes(location.hostname);
window.addEventListener('resize',()=>{ if(window.matchMedia('(min-width: 981px)').matches) closeSide(); else setSide($('sidebar').classList.contains('open')); });
fbConnect();
setInterval(refreshTelemetry,1000);
setInterval(() => { updateSchedHint(); updateModeInfo(); }, 30000);
// Tidak ada penulisan otomatis setting saat login/telemetry/prune; hanya Simpan.
