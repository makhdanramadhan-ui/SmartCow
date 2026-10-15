// Generate auditable field-level RTDB permissions; never deploy from this script.
const fs=require('node:fs');
const path=require('node:path');
const admin="auth != null && root.child('access').child(auth.uid).child('enabled').val() == true && root.child('access').child(auth.uid).child('role').val() == 'admin'";
const can=permission=>`auth != null && root.child('access').child(auth.uid).child('enabled').val() == true && root.child('access').child(auth.uid).child('permissions/monitor').val() == true && (root.child('access').child(auth.uid).child('role').val() == 'admin' || root.child('access').child(auth.uid).child('permissions/${permission}').val() == true)`;
const device=p=>`$device == 'cow-sprinkler-01' && (${can(p)})`;
const settingFields=['controlPolicyVersion','controlBasis','threshold','hysteresis','maxDuration','cooldown','autoSrc','schN','schOn'];
for(const prefix of ['', 'temp','thi']){
  if(prefix)for(const key of ['Threshold','Hysteresis','MaxDuration','Cooldown','AutoSrc','SchN'])settingFields.push(prefix+key);
  for(let i=1;i<=6;i++)for(const key of ['Date','Start','Dur'])settingFields.push(prefix+'Sch'+i+key);
}
// Existing legacy fields use lower-case sch; preserve firmware compatibility.
const fields=[...new Set(settingFields.map(k=>k.startsWith('Sch')?'s'+k.slice(1):k))];
const control={'.read':device('monitor'),'.validate':"newData.hasChild('mode') && (newData.child('mode').val() == 'auto' || newData.child('mode').val() == 'manual')"};
for(const key of fields){
  let validate;
  if(key==='controlPolicyVersion')validate='newData.val() == 2';
  else if(key==='controlBasis')validate="newData.val() == 'temperature' || newData.val() == 'thi'";
  else if(/autoSrc$/i.test(key))validate="newData.val() == 'threshold' || newData.val() == 'schedule'";
  else if(/Date$/.test(key))validate="newData.isString() && newData.val().matches(/^20[0-9]{2}-[0-9]{2}-[0-9]{2}$/)";
  else if(/Start$/.test(key))validate="newData.isString() && newData.val().matches(/^([01][0-9]|2[0-3]):[0-5][0-9]$/)";
  else {
    let min=0,max=10800;
    if(/Threshold$/i.test(key)){min=key.startsWith('thi')?0:-55;max=key.startsWith('thi')?120:125;}
    else if(/Hysteresis$/i.test(key))max=50;
    else if(/SchN$/i.test(key))max=6;
    else if(key==='schOn')max=1;
    else if(/Dur$/.test(key)){min=1;max=180;}
    else if(/MaxDuration$/i.test(key))min=1;
    validate=`newData.isNumber() && newData.val() >= ${min} && newData.val() <= ${max}`;
    if(/(?:SchN|Dur|MaxDuration|Cooldown|schOn)$/i.test(key))validate+=' && newData.val() % 1 == 0';
  }
  control[key]={'.write':device('settings'),'.validate':validate};
}
control.mode={'.write':device('operate'),'.validate':"newData.val() == 'auto' || newData.val() == 'manual'"};
control.manualSsr={'.write':device('operate'),'.validate':"newData.val() == 'on' || newData.val() == 'off'"};
for(const key of ['updatedAt','updatedBy'])control[key]={'.write':`(${device('settings')}) || (${device('operate')})`,'.validate':key==='updatedAt'?'newData.isNumber()':"newData.isString() && newData.val() == auth.uid"};
control.$other={'.validate':false};
const str=max=>({'.validate':`newData.isString() && newData.val().length <= ${max}`});
const bool={'.validate':'newData.isBoolean()'};
const rules={rules:{'.read':false,'.write':false,
  access:{'.read':admin,$uid:{
    '.read':"auth != null && auth.uid == $uid",
    '.write':`(${admin}) && $uid != auth.uid && ((!data.exists() && newData.exists()) || (data.child('role').val() == 'user' && (!newData.exists() || newData.child('role').val() == 'user')))`,
    '.validate':"newData.hasChildren(['email','name','role','enabled','permissions','updatedAt']) && (!(newData.child('permissions/settings').val() == true || newData.child('permissions/operate').val() == true) || newData.child('permissions/monitor').val() == true) && (newData.child('role').val() != 'admin' || (newData.child('enabled').val() == true && newData.child('permissions/monitor').val() == true && newData.child('permissions/settings').val() == true && newData.child('permissions/operate').val() == true))",
    email:{'.validate':"newData.isString() && newData.val().length <= 254 && (!data.exists() || newData.val() == data.val())"},
    name:str(80),role:{'.validate':"newData.val() == 'user' || newData.val() == 'admin'"},enabled:bool,
    permissions:{'.validate':"newData.hasChildren(['monitor','settings','operate'])",monitor:bool,settings:bool,operate:bool,$other:{'.validate':false}},
    createdAt:{'.validate':'newData.isNumber() && (!data.exists() || newData.val() == data.val())'},updatedAt:{'.validate':'newData.isNumber()'},$other:{'.validate':false}}},
  devices:{$device:{telemetry:{latest:{'.read':device('monitor')},log:{'.read':device('monitor'),'.indexOn':['ts']}},control,
    events:{'.read':device('monitor'),'.indexOn':['ts'],$pushId:{
      '.write':`((${device('settings')}) || (${device('operate')})) && !data.exists() && newData.exists()`,
      '.validate':"newData.hasChildren(['type','reason','ts'])",type:{'.validate':"newData.val() == 'web'"},reason:str(500),ts:{'.validate':'newData.isNumber()'},$other:{'.validate':false}}},
    status:{'.read':device('monitor')}}}}};
const target=path.resolve(__dirname,'../database.rules.json');
const text=JSON.stringify(rules,null,2)+'\n';
if(process.argv.includes('--check')){if(fs.readFileSync(target,'utf8').replaceAll('\r\n','\n')!==text)throw Error('Rules out of date. Run node scripts/build-rules.cjs');}
else fs.writeFileSync(target,text);
