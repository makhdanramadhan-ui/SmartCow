// Cache draft saja; setting terapan dari Firebase, tidak ditulis otomatis saat login.
let stored = {};
try { stored = JSON.parse(localStorage.getItem('scs_cfg') || '{}') || {}; } catch {}
let CFG = SCSControl.normalize(stored);
function saveCfg(){ SCSControl.capture(CFG); localStorage.setItem('scs_cfg',JSON.stringify(CFG)); }
