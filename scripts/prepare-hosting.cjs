// Publish only runtime assets: never firmware, local credentials, or repository docs.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const assets = ['index.html','css/style.css','js/core.js','js/control.js','js/telemetry.js','js/config.js',
  'js/firebase-public.js','js/firebase.js','js/app.js'];
const output = path.join(root,'public');
fs.mkdirSync(output,{recursive:true});
// Refuse unexpected leftovers rather than silently publishing or deleting them.
function check(dir){
  for (const entry of fs.readdirSync(dir,{withFileTypes:true})){
    const full = path.join(dir,entry.name);
    if (entry.isSymbolicLink()) throw new Error('Symlink is not a hosting asset: '+full);
    if (entry.isDirectory()) check(full);
    else if (!assets.includes(path.relative(output,full).split(path.sep).join('/')))
      throw new Error('Unexpected file in public/: '+full+' (inspect it before deployment)');
  }
}
check(output);
for (const asset of assets){
  const source=path.join(root,asset), target=path.join(output,asset);
  const text=fs.readFileSync(source,'utf8');
  if (/\b(?:DATABASE_SECRET|WIFI_PASSWORD)\b|\bpassword\s*:\s*['"][^'"]+['"]/i.test(text))
    throw new Error('Credential-like literal in public asset: '+asset);
  fs.mkdirSync(path.dirname(target),{recursive:true});
  fs.copyFileSync(source,target);
}
console.log('Prepared '+assets.length+' allowlisted web assets in public/ (no firmware/local credential config).');
