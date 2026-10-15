// Requires local demo emulators. No production credentials or writes.
const {initializeTestEnvironment,assertSucceeds,assertFails}=require('@firebase/rules-unit-testing');
const {ref,set,get,update,push,serverTimestamp}=require('firebase/database');
const {initializeAuth,inMemoryPersistence,connectAuthEmulator,createUserWithEmailAndPassword,signInWithEmailAndPassword}=require('firebase/auth');
const {initializeApp,deleteApp}=require('firebase/app');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../..'),C=require('../../js/control.js'),A=require('../../js/access.js');
const projectId='demo-smartcow-access',base='devices/cow-sprinkler-01';
(async()=>{
  if(!process.env.FIREBASE_DATABASE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST)throw Error('Run npm test from test/rbac, never against production.');
  const env=await initializeTestEnvironment({projectId,database:{host:'127.0.0.1',port:9000,rules:fs.readFileSync(path.join(root,'database.rules.json'),'utf8')}});
  let count=0;
  const pass=async p=>{await assertSucceeds(p);count++;},fail=async p=>{await assertFails(p);count++;};
  const db=uid=>uid?env.authenticatedContext(uid).database():env.unauthenticatedContext().database();
  const user=(monitor,settings,operate,enabled=true)=>A.userRecord({email:'user@example.test',monitor,settings,operate,enabled},1);
  try{
    await env.withSecurityRulesDisabled(async c=>{
      await set(ref(c.database(),'access'),{admin:{...user(true,true,true),role:'admin'},monitor:user(true,false,false),settings:user(true,true,false),operate:user(true,false,true),full:user(true,true,true),disabled:user(true,true,true,false)});
      await set(ref(c.database(),base),{control:{...C.toFirebase(C.normalize({mode:'auto'})),manualSsr:'off'},telemetry:{latest:{ts:1},log:{a:{ts:1}}},events:{a:{type:'web',reason:'seed',ts:1}},status:{online:true}});
    });
    for(const uid of [null,'unknown','disabled']){
      for(const part of ['telemetry/latest','telemetry/log','control','events','status'])await fail(get(ref(db(uid),base+'/'+part)));
      await fail(update(ref(db(uid),base+'/control'),{mode:'manual'}));
      if(uid)await pass(get(ref(db(uid),'access/'+uid)));
      await fail(get(ref(db(uid),'access')));await fail(get(ref(db(uid),'access/admin')));
    }
    for(const uid of ['monitor','settings','operate','full','admin']){
      for(const part of ['telemetry/latest','telemetry/log','control','events','status'])await pass(get(ref(db(uid),base+'/'+part)));
      await pass(get(ref(db(uid),'access/'+uid)));
      for(const target of ['devices',base,'devices/other/control'])await fail(get(ref(db(uid),target)));
      for(const target of ['telemetry/latest','telemetry/log/new','status'])await fail(set(ref(db(uid),base+'/'+target),{ts:1,ssr:1}));
      if(uid!=='admin'){await fail(get(ref(db(uid),'access')));await fail(get(ref(db(uid),'access/admin')));}
    }
    const settings=A.settingsPayload(C.toFirebase(C.normalize({threshold:31.5})));
    for(const uid of ['settings','full','admin'])await pass(update(ref(db(uid),base+'/control'),{...settings,updatedAt:serverTimestamp(),updatedBy:uid}));
    for(const uid of ['monitor','operate','unknown','disabled'])await fail(update(ref(db(uid),base+'/control'),settings));
    for(const uid of ['operate','full','admin']){await pass(update(ref(db(uid),base+'/control'),{mode:'manual',manualSsr:'on',updatedAt:serverTimestamp(),updatedBy:uid}));await pass(update(ref(db(uid),base+'/control'),{manualSsr:'off'}));}
    for(const uid of ['monitor','settings'])for(const change of [{mode:'auto'},{manualSsr:'on'},{tempThreshold:32,mode:'auto'}])await fail(update(ref(db(uid),base+'/control'),change));
    for(const [key,val] of [['tempThreshold',999],['thiThreshold',-1],['tempMaxDuration',0],['tempSchN',7],['thiSch1Start','25:99'],['manualSsr','yes'],['mode','other'],['hack',1],['updatedBy','other-user']])await fail(update(ref(db('admin'),base+'/control'),{[key]:val}));
    for(const uid of ['settings','operate','full','admin'])await pass(set(push(ref(db(uid),base+'/events')),{type:'web',reason:'test',ts:serverTimestamp()}));
    await fail(set(push(ref(db('monitor'),base+'/events')),{type:'web',reason:'hack',ts:1}));
    for(const value of [null,{type:'web',reason:'overwrite',ts:1}])await fail(set(ref(db('full'),base+'/events/a'),value));
    await fail(set(push(ref(db('full'),base+'/events')),{type:'web',reason:'hack',ts:1,extra:'bad'}));
    const admin=db('admin');await pass(get(ref(admin,'access')));await pass(set(ref(admin,'access/new-user'),user(true,true,true)));
    for(const uid of ['monitor','settings','operate','full','unknown']){
      await fail(update(ref(db(uid),'access/'+uid),{role:'admin'}));await fail(update(ref(db(uid),'access/'+uid),{'permissions/operate':true}));await fail(set(ref(db(uid),'access/injected'),user(true,true,true)));
    }
    await fail(update(ref(admin,'access/admin'),{enabled:false}));
    await pass(set(ref(admin,'access/new-admin'),A.accountRecord({email:'peer@emulator.test',role:'admin'},1)));
    await pass(get(ref(db('new-admin'),'access')));
    for(const target of ['admin','new-admin']){
      await fail(set(ref(admin,'access/'+target),null));
      await fail(update(ref(admin,'access/'+target),{enabled:false}));
      await fail(update(ref(admin,'access/'+target),{role:'user'}));
      await fail(update(ref(admin,'access/'+target),{'permissions/operate':false}));
    }
    await fail(set(ref(db('new-admin'),'access/admin'),null));
    await fail(update(ref(db('new-admin'),'access/admin'),{enabled:false}));
    await fail(update(ref(admin,'access/new-user'),{role:'admin'}));
    for(const data of [A.accountRecord({email:'bad@emulator.test',role:'admin',enabled:false},1),{...user(true,false,false),role:'admin'}])await fail(set(ref(admin,'access/invalid-admin'),data));
    for(const uid of [null,'unknown','monitor','settings','operate','full','disabled']){
      await fail(set(ref(db(uid),'access/injected-admin'),A.accountRecord({email:'injected@emulator.test',role:'admin'},1)));
      await fail(set(ref(db(uid),'access/new-user'),null));
    }
    for(const change of [{email:'replacement@example.test'},{'permissions/monitor':false},{unknown:1}])await fail(update(ref(admin,'access/new-user'),change));
    await pass(update(ref(admin,'access/full'),{enabled:false}));await fail(get(ref(db('full'),base+'/telemetry/latest')));await fail(update(ref(db('full'),base+'/control'),{manualSsr:'on'}));
    await pass(update(ref(admin,'access/full'),{enabled:true,'permissions/operate':false}));await pass(get(ref(db('full'),base+'/telemetry/latest')));await fail(update(ref(db('full'),base+'/control'),{mode:'manual'}));
    await pass(set(ref(admin,'access/new-user'),null));
    await fail(get(ref(db('new-user'),base+'/telemetry/latest')));
    await fail(update(ref(db('new-user'),base+'/control'),{manualSsr:'on'}));
    await fail(set(ref(db('new-user'),'access/new-user'),user(true,true,true)));
    await fail(set(ref(admin,'access'),null));
    const apps=[];
    try{
      const create=async(name,email)=>{const app=initializeApp({apiKey:'fake-api-key',projectId},name);apps.push(app);const auth=initializeAuth(app,{persistence:inMemoryPersistence});connectAuthEmulator(auth,'http://127.0.0.1:9099',{disableWarnings:true});const result=await createUserWithEmailAndPassword(auth,email,'Emulator-only-123');return {auth,uid:result.user.uid};};
      const primary=await create('admin','admin@emulator.test'),secondary=await create('isolated','user@emulator.test');assert.equal(primary.auth.currentUser.uid,primary.uid);assert.notEqual(primary.uid,secondary.uid);count++;
      await pass(set(ref(admin,'access/'+secondary.uid),user(true,true,true)));
      await pass(get(ref(db(secondary.uid),base+'/telemetry/latest')));
      await pass(set(ref(admin,'access/'+secondary.uid),null));
      await fail(get(ref(db(secondary.uid),base+'/telemetry/latest')));
      // Without billing/backend, removal deliberately leaves the Auth identity intact.
      await signInWithEmailAndPassword(secondary.auth,'user@emulator.test','Emulator-only-123');count++;
      await assert.rejects(create('duplicate','user@emulator.test'),e=>e.code==='auth/email-already-in-use');count++;
      const peer=await create('peer-admin','peer-admin@emulator.test');
      await pass(set(ref(admin,'access/'+peer.uid),A.accountRecord({email:'peer-admin@emulator.test',role:'admin'},1)));
      await pass(get(ref(db(peer.uid),'access')));
      await fail(set(ref(admin,'access/'+peer.uid),null));
    }finally{await Promise.all(apps.map(deleteApp));}
    console.log(`RBAC emulator PASS: ${count} checks; no production access.`);
  }finally{await env.cleanup();}
})().catch(error=>{console.error(error);process.exitCode=1;});
