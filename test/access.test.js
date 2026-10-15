const test=require('node:test');
const assert=require('node:assert/strict');
const A=require('../js/access.js');
const C=require('../js/control.js');
test('access is fail-closed for missing, malformed, disabled and unknown accounts',()=>{
  for(const raw of [null,{},true,{enabled:'true',role:'admin'},{enabled:false,role:'admin',permissions:{monitor:true,settings:true,operate:true}}])
    for(const p of [...A.permissions,'admin'])assert.equal(A.can(raw,p),false);
});
test('Admin has all permissions; full User never has account-management privileges',()=>{
  for(const p of [...A.permissions,'admin'])assert.equal(A.can({enabled:true,role:'admin'},p),true);
  const user={enabled:true,role:'user',permissions:{monitor:true,settings:true,operate:true}};
  for(const p of A.permissions)assert.equal(A.can(user,p),true);
  assert.equal(A.can(user,'admin'),false);assert.equal(A.can(user,'unknown'),false);
});
test('all eight User permission combinations preserve independent settings and operations',()=>{
  for(let bits=0;bits<8;bits++){
    const record=A.userRecord({email:' TEST@example.com ',name:' Name ',monitor:!!(bits&1),settings:!!(bits&2),operate:!!(bits&4)},123);
    assert.equal(record.email,'test@example.com');assert.equal(record.role,'user');assert.equal(record.name,'Name');
    assert.equal(A.can(record,'monitor'),!!bits);assert.equal(A.can(record,'settings'),!!(bits&2));assert.equal(A.can(record,'operate'),!!(bits&4));
  }
});
test('corrupt settings or operations without Monitoring do not grant access',()=>{
  for(const permission of ['settings','operate'])assert.equal(A.can({enabled:true,permissions:{[permission]:true}},permission),false);
});
test('settings save never includes mode or manual output while preserving both profiles',()=>{
  const raw=C.toFirebase(C.normalize({mode:'manual',threshold:31}));
  const payload=A.settingsPayload({...raw,manualSsr:'on',updatedAt:12,updatedBy:'other'});
  for(const k of ['mode','manualSsr','updatedAt','updatedBy'])assert.equal(k in payload,false);
  assert.equal(payload.tempThreshold,31);assert.equal(payload.thiThreshold,72);assert.equal(payload.controlPolicyVersion,2);
});
test('explicit Admin creation grants all permissions but User edits cannot promote',()=>{
  const record=A.accountRecord({email:' ADMIN@example.com ',name:' Admin ',role:'admin'},123);
  assert.equal(record.role,'admin');assert.equal(record.enabled,true);assert.equal(record.email,'admin@example.com');
  for(const permission of [...A.permissions,'admin'])assert.equal(A.can(record,permission),true);
  const user=A.userRecord({email:'user@example.com',role:'admin',monitor:true},123);
  assert.equal(user.role,'user');assert.equal(A.can(user,'admin'),false);
  assert.throws(()=>A.accountRecord({email:'user@example.com',role:'owner'},123),/Jenis akun/);
});
