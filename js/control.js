// Dua profil independen; threshold THI tidak pernah disalin ke threshold suhu legacy.
(function (root, factory) {
  const api = factory(typeof module !== 'undefined' && module.exports ? require('./core.js') : root.SCS);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SCSControl = api;
})(typeof self !== 'undefined' ? self : globalThis, (SCS) => {
  const basisOf = c => c?.controlBasis === 'thi' ? 'thi' : 'temperature';
  const bounded = (v, min, max, fallback) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : fallback;
  function profile(raw = {}, basis = 'temperature') {
    const thi = basis === 'thi';
    return { threshold: bounded(raw.threshold, thi ? 0 : -55, thi ? 120 : 125, thi ? 72 : 30),
      hysteresis: bounded(raw.hysteresis,0,50,thi ? 2 : 1),
      maxDuration: Math.round(bounded(raw.maxDuration,1,10800,120)),
      cooldown: Math.round(bounded(raw.cooldown,0,10800,60)),
      autoSrc: SCS.autoSrcOf(raw), schedules: SCS.schedulesOf(raw,SCS.wibDateStr()) };
  }
  function normalize(raw = {}) {
    const controlBasis = basisOf(raw);
    const profiles = {
      temperature: profile(raw.profiles?.temperature || (controlBasis === 'temperature' ? raw : {})),
      thi: profile(raw.profiles?.thi || (controlBasis === 'thi' ? raw : {}),'thi')
    };
    return { mode: raw.mode === 'manual' ? 'manual' : 'auto', controlBasis, profiles,
      ...profiles[controlBasis], schedules: profiles[controlBasis].schedules.map(s=>({...s})) };
  }
  function capture(cfg) {
    cfg.profiles[basisOf(cfg)] = profile(cfg,basisOf(cfg));
    return cfg;
  }
  function selectBasis(cfg, basis) {
    capture(cfg);
    return normalize({ ...cfg, controlBasis: basis });
  }
  function fromFirebase(raw = {}) {
    if (raw.controlPolicyVersion !== 2) return normalize({ ...raw, schedOn:raw.schOn ?? raw.schedOn, controlBasis:'temperature', profiles:undefined,
      schedules: slots(raw,'') });
    const profiles = {};
    for (const [basis,prefix] of [['temperature','temp'],['thi','thi']]) {
      const p = { schedules:slots(raw,prefix) };
      for (const k of ['threshold','hysteresis','maxDuration','cooldown','autoSrc']) p[k]=raw[prefix+k[0].toUpperCase()+k.slice(1)];
      profiles[basis]=profile(p,basis);
    }
    return normalize({mode:raw.mode,controlBasis:raw.controlBasis,profiles});
  }
  function slots(raw, prefix) {
    const key = k => prefix ? prefix+k[0].toUpperCase()+k.slice(1) : k;
    if (Number.isInteger(raw[key('schN')])) return Array.from({length:Math.min(6,Math.max(0,raw[key('schN')]))},(_,i)=>({
      date:raw[key(`sch${i+1}Date`)],start:raw[key(`sch${i+1}Start`)],dur:raw[key(`sch${i+1}Dur`)] }));
    return prefix ? [] : SCS.schedulesOf({schedStart:raw.schStart,schedDur:raw.schDur},SCS.wibDateStr());
  }
  function toFirebase(cfg) {
    cfg=normalize(capture(cfg));
    const out={controlPolicyVersion:2,controlBasis:cfg.controlBasis,mode:cfg.mode};
    for (const [basis,prefix] of [['temperature','temp'],['thi','thi']]) {
      const p=cfg.profiles[basis];
      for (const k of ['threshold','hysteresis','maxDuration','cooldown','autoSrc']) out[prefix+k[0].toUpperCase()+k.slice(1)]=p[k];
      out[prefix+'SchN']=p.schedules.length;
      for(let i=0;i<6;i++) for(const [field,key] of [['date','Date'],['start','Start'],['dur','Dur']])
        out[`${prefix}Sch${i+1}${key}`]=p.schedules[i]?.[field] ?? null;
    }
    // Firmware lama tidak boleh membaca threshold THI 72 sebagai 72 °C.
    const temp=cfg.profiles.temperature;
    for(const k of ['threshold','hysteresis','maxDuration','cooldown','autoSrc']) out[k]=temp[k];
    out.schN=temp.schedules.length; out.schOn=temp.autoSrc==='schedule' && temp.schedules.length ? 1 : 0;
    for(let i=0;i<6;i++) for(const [field,key] of [['date','Date'],['start','Start'],['dur','Dur']])
      out[`sch${i+1}${key}`]=temp.schedules[i]?.[field] ?? null;
    return out;
  }
  return {normalize,profile,capture,selectBasis,fromFirebase,toFirebase,basisOf};
});
