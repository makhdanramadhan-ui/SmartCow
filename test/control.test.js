const test = require('node:test');
const assert = require('node:assert/strict');
const SCS = require('../js/core.js');
const C = require('../js/control.js');
const ready = {complete:true,scheduleActive:true,runSeconds:0,offSeconds:60};

test('THI formula: DS 30 C + RH 70% = 81.38, not DHT companion temperature', () => {
  assert.ok(Math.abs(SCS.thiOf(30,70)-81.38)<1e-9);
  assert.equal(SCS.thiOf(30,100),86);
  assert.ok(Math.abs(SCS.thiOf(30,0)-70.6)<1e-9);
});
test('THI rejects missing, nonnumeric, nonfinite and out-of-range inputs', () => {
  for(const [t,rh] of [[null,70],[30,null],['30',70],[NaN,70],[30,Infinity],[-127,70],[30,101],[30,-1]])
    assert.equal(SCS.thiOf(t,rh),null);
});
test('two profiles start with separate thresholds and hysteresis', () => {
  const cfg=C.normalize();
  assert.equal(cfg.controlBasis,'temperature'); assert.equal(cfg.threshold,30);
  assert.equal(cfg.profiles.thi.threshold,72); assert.equal(cfg.profiles.thi.hysteresis,2);
  assert.deepEqual(cfg.schedules,[]);
});
test('switching basis preserves each threshold, protection, source and schedule', () => {
  let cfg=C.normalize({threshold:31,hysteresis:1.5,maxDuration:90,cooldown:20,autoSrc:'schedule',
    schedules:[{date:'2026-11-12',start:'14:00',dur:10}]});
  cfg=C.selectBasis(cfg,'thi');
  assert.equal(cfg.threshold,72); assert.equal(cfg.autoSrc,'threshold'); assert.deepEqual(cfg.schedules,[]);
  cfg.threshold=75; cfg.hysteresis=3; cfg.maxDuration=45; cfg.cooldown=80; cfg.autoSrc='schedule';
  cfg.schedules=[{date:'2026-11-13',start:'16:00',dur:20}];
  cfg=C.selectBasis(cfg,'temperature');
  assert.equal(cfg.threshold,31); assert.equal(cfg.hysteresis,1.5); assert.equal(cfg.maxDuration,90);
  assert.equal(cfg.cooldown,20); assert.equal(cfg.schedules[0].start,'14:00');
  cfg=C.selectBasis(cfg,'thi');
  assert.equal(cfg.threshold,75); assert.equal(cfg.maxDuration,45); assert.equal(cfg.cooldown,80);
  assert.equal(cfg.schedules[0].date,'2026-11-13'); assert.equal(cfg.schedules[0].start,'16:00');
});
test('Firebase v2 roundtrip keeps inactive profile, empty slots and safe legacy temperature fields', () => {
  let cfg=C.selectBasis(C.normalize({threshold:32,autoSrc:'schedule',schedules:[{date:'2026-11-12',start:'09:00',dur:8}]}),'thi');
  cfg.threshold=74; cfg.cooldown=0;
  const wire=C.toFirebase(cfg), round=C.fromFirebase(wire);
  assert.equal(wire.controlPolicyVersion,2); assert.equal(wire.controlBasis,'thi');
  assert.equal(wire.thiThreshold,74); assert.equal(wire.threshold,32);
  assert.equal(wire.thiSch1Date,null); assert.equal(wire.thiSchN,0);
  assert.equal(wire.tempSch1Start,'09:00'); assert.equal(wire.sch1Start,'09:00');
  assert.deepEqual(round,C.normalize(C.capture(cfg)));
});
test('legacy settings migrate into temperature profile without changing threshold or dated schedule', () => {
  const cfg=C.fromFirebase({mode:'auto',threshold:29,hysteresis:0.5,maxDuration:50,cooldown:40,
    autoSrc:'schedule',schN:1,sch1Date:'2026-11-12',sch1Start:'23:55',sch1Dur:10});
  assert.equal(cfg.threshold,29); assert.equal(cfg.profiles.thi.threshold,72);
  assert.deepEqual(cfg.schedules,[{date:'2026-11-12',start:'23:55',dur:10}]);
});
test('legacy recurring schedule migrates once to current WIB date, no spontaneous default schedules', () => {
  const cfg=C.fromFirebase({mode:'auto',schOn:1,schStart:'12:00',schDur:10});
  assert.equal(cfg.autoSrc,'schedule'); assert.equal(cfg.schedules[0].date,SCS.wibDateStr());
  assert.equal(cfg.schedules[0].start,'12:00');
  assert.deepEqual(C.fromFirebase({mode:'auto',schN:0}).schedules,[]);
});
test('normalization rejects corrupt profile values and never replaces zero cooldown', () => {
  const cfg=C.normalize({controlBasis:'thi',threshold:1000,hysteresis:'2',maxDuration:-1,cooldown:0});
  assert.equal(cfg.threshold,72); assert.equal(cfg.hysteresis,2); assert.equal(cfg.maxDuration,120);
  assert.equal(cfg.cooldown,0); assert.equal(C.normalize({controlBasis:'invalid'}).controlBasis,'temperature');
});
for(const [basis,threshold,hysteresis] of [['temperature',30,1],['thi',72,2]]) {
  test(`${basis}: active schedule never forces ON below threshold`, () => {
    const cfg={threshold,hysteresis,maxDuration:120,cooldown:60,autoSrc:'schedule'};
    assert.equal(SCS.decideAutomatic(threshold-4,false,cfg,ready),'stay');
    assert.equal(SCS.decideAutomatic(threshold,false,cfg,ready),'on');
    assert.equal(SCS.decideAutomatic(threshold-0.5,true,cfg,ready),'stay');
    assert.equal(SCS.decideAutomatic(threshold-hysteresis,true,cfg,ready),'off');
  });
  test(`${basis}: schedule bounds, sensor failure, duration and cooldown all apply`, () => {
    const cfg={threshold,hysteresis,maxDuration:120,cooldown:60,autoSrc:'schedule'};
    assert.equal(SCS.decideAutomatic(threshold+5,true,cfg,{...ready,scheduleActive:false}),'off');
    assert.equal(SCS.decideAutomatic(threshold+5,false,cfg,{...ready,scheduleActive:false}),'off');
    assert.equal(SCS.decideAutomatic(threshold+5,true,cfg,{...ready,complete:false}),'off');
    assert.equal(SCS.decideAutomatic(NaN,true,cfg,ready),'off');
    assert.equal(SCS.decideAutomatic(threshold+5,true,cfg,{...ready,runSeconds:120}),'off');
    assert.equal(SCS.decideAutomatic(threshold+5,false,cfg,{...ready,offSeconds:59}),'stay');
    assert.equal(SCS.decideAutomatic(threshold+5,false,cfg,{...ready,offSeconds:60}),'on');
  });
  test(`${basis}: throughout-time source ignores schedule but retains all protections`, () => {
    const cfg={threshold,hysteresis,maxDuration:120,cooldown:60,autoSrc:'threshold'};
    assert.equal(SCS.decideAutomatic(threshold+5,false,cfg,{...ready,scheduleActive:false}),'on');
    assert.equal(SCS.decideAutomatic(threshold+5,true,cfg,{...ready,runSeconds:120}),'off');
    assert.equal(SCS.decideAutomatic(threshold+5,false,cfg,{...ready,offSeconds:0}),'stay');
  });
}
test('dated schedule crosses midnight and ends exactly at its bound', () => {
  const slots=[{date:'2026-11-12',start:'23:55',dur:10}];
  assert.equal(SCS.anyScheduleActive(SCS.wibDateTimeMs('2026-11-13','00:04'),slots),true);
  assert.equal(SCS.anyScheduleActive(SCS.wibDateTimeMs('2026-11-13','00:05'),slots),false);
});
