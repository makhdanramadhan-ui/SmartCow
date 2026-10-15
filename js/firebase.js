// Public SDK only. Database Rules enforce every permission independently of this UI.
import {initializeApp,getApps,deleteApp} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import {getDatabase,ref,onValue,update,set,push,query,orderByChild,limitToLast,serverTimestamp} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-database.js';
import {getAuth,signInWithEmailAndPassword,onAuthStateChanged,signOut,initializeAuth,inMemoryPersistence,createUserWithEmailAndPassword,deleteUser,sendPasswordResetEmail} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';

let db,auth,callbacks={},unsubs=[],accessUnsub=null,timeOffset=0,access=null,generation=0;
const base=()=>`devices/${window.FIREBASE_CONFIG?.deviceId || 'cow-sprinkler-01'}`;
const can=p=>window.SCSAccess.can(access,p);
function stopData(){unsubs.forEach(fn=>fn());unsubs=[];}
function stopSession(){stopData();accessUnsub?.();accessUnsub=null;access=null;}
function need(permission){if(!auth?.currentUser || !can(permission))throw new Error('Akun tidak memiliki izin untuk tindakan ini.');}
function listen(session){
  stopData();
  const active=()=>session===generation;
  const failed=()=>{if(active())callbacks.onStatus?.('Data tidak dapat diakses. Periksa koneksi atau hubungi Admin.','err');};
  unsubs.push(onValue(ref(db,'.info/serverTimeOffset'),snap=>{if(active())timeOffset=snap.val()||0;}));
  unsubs.push(onValue(ref(db,'.info/connected'),snap=>{if(active())callbacks.onTransport?.(snap.val()===true);}));
  if(!can('monitor'))return;
  const watch=(path,fn)=>unsubs.push(onValue(ref(db,path),snap=>{if(active()&&can('monitor'))fn(snap.val());},failed));
  watch(base()+'/telemetry/latest',value=>callbacks.onTelemetry?.(value));
  watch(base()+'/control',value=>callbacks.onControl?.(value));
  for(const [path,count,callback,convert] of [
    ['/events',50,'onEvents',raw=>({t:raw.ts,msg:String(raw.reason||raw.type||'Aktivitas sprinkler')})],
    ['/telemetry/log',120,'onSeedLogs',raw=>SCSTelemetry.logRow(raw)]]){
    unsubs.push(onValue(query(ref(db,base()+path),orderByChild('ts'),limitToLast(count)),snap=>{
      if(!active()||!can('monitor'))return;
      const rows=[];snap.forEach(child=>{const raw=child.val();if(raw&&typeof raw.ts==='number')rows.push(convert(raw));});
      callbacks[callback]?.(rows.reverse());
    },failed));
  }
}
async function connect(handlers){
  callbacks=handlers;if(auth)return;
  const c=window.FIREBASE_CONFIG;
  if(!c?.apiKey||!c?.databaseURL)throw new Error('Konfigurasi Firebase publik belum lengkap.');
  const app=getApps().find(a=>a.name==='[DEFAULT]')||initializeApp(c);
  db=getDatabase(app);auth=getAuth(app);
  onAuthStateChanged(auth,user=>{
    const session=++generation;stopSession();callbacks.onAccess?.(null);
    if(!user){callbacks.onAuth?.(false,'');callbacks.onTelemetry?.(null);return;}
    // Do not reveal private content while access is still being restored.
    let resolved=false,previous='';
    accessUnsub=onValue(ref(db,`access/${user.uid}`),snap=>{
      if(session!==generation)return;
      access=window.SCSAccess.normalize(snap.val());
      const signature=JSON.stringify(access);
      if(signature===previous&&resolved)return;
      previous=signature;stopData();callbacks.onAccess?.(access);
      if(!resolved){resolved=true;callbacks.onAuth?.(true,user.email||'');}
      listen(session);
    },error=>{
      if(session!==generation)return;
      stopData();access=null;callbacks.onAccess?.(null);
      if(!resolved)callbacks.onAuthError?.(error);
      else callbacks.onStatus?.('Izin akun tidak dapat diperiksa. Akses ditutup sampai koneksi pulih.','err');
    });
  },error=>callbacks.onAuthError?.(error));
}
async function login(email,password){if(!auth)throw new Error('Firebase belum siap.');return signInWithEmailAndPassword(auth,email,password);}
function pushControl(obj){
  for(const key of Object.keys(obj))need(key==='mode'||key==='manualSsr'?'operate':'settings');
  return update(ref(db,base()+'/control'),{...obj,updatedAt:serverTimestamp(),updatedBy:auth.currentUser.uid});
}
async function pushOverride(on,reason){need('operate');await pushControl({manualSsr:on?'on':'off'});await pushEvent(reason||(on?'Manual ON diminta':'Manual OFF diminta'));}
function pushEvent(msg){
  if(!can('settings'))need('operate');
  return push(ref(db,base()+'/events'),{type:'web',reason:String(msg).slice(0,500),ts:serverTimestamp()});
}
function subscribeUsers(onUsers,onError){
  need('admin');
  return onValue(ref(db,'access'),snap=>onUsers(Object.entries(snap.val()||{}).map(([uid,record])=>({uid,...record}))),onError);
}
async function saveUser(uid,record){
  need('admin');if(uid===auth.currentUser.uid)throw new Error('Akses Admin sendiri tidak dapat diubah.');
  return update(ref(db,`access/${uid}`),window.SCSAccess.userRecord(record,serverTimestamp()));
}
async function createUser(record,password){
  need('admin');
  // An isolated, nonpersistent Auth instance never replaces the Admin session.
  const app=initializeApp(window.FIREBASE_CONFIG,`create-user-${crypto.randomUUID()}`);
  const secondary=initializeAuth(app,{persistence:inMemoryPersistence});
  let created;
  try{
    created=(await createUserWithEmailAndPassword(secondary,record.email.trim(),password)).user;
    need('admin');
    const data=window.SCSAccess.userRecord(record,serverTimestamp());
    await set(ref(db,`access/${created.uid}`),{...data,createdAt:serverTimestamp()});
    return created.uid;
  }catch(error){
    if(created){
      try{await deleteUser(created);}
      catch{throw new Error(`Akun dibuat tetapi belum mendapat akses. Simpan UID ini untuk pemulihan oleh pemilik proyek: ${created.uid}`);}
    }
    throw error;
  }finally{
    // Cleanup must not turn a successfully provisioned account into a reported failure.
    try{await signOut(secondary);}catch{}
    try{await deleteApp(app);}catch{}
  }
}
async function resetPassword(email){need('admin');return sendPasswordResetEmail(auth,email);}
window.SCSFirebase={connect,login,logout:()=>signOut(auth),pushControl,pushOverride,pushEvent,subscribeUsers,saveUser,createUser,resetPassword,
  now:()=>Date.now()+timeOffset};
