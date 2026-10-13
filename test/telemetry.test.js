const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../js/telemetry.js');
const SCS = require('../js/core.js');
const now = 1791800000000;
const sample = (extra = {}) => ({
  ts: now, measuredTs: now, schemaVersion: 3, n: 6,
  t1: 30, t2: 31, t3: 32, t4: 33, t5: 34, t6: 35,
  validMask: 63, validCount: 6, avg: 32.5, ssr: 1,
  temperatureAgeMs: [100,100,100,500,500,500],
  h1: 70, h2: 80, h3: 60, h4: 90, d1: 31, d2: 32, d3: 33, d4: 34,
  humidityValidMask: 15, humidityAgeMs: [100,200,300,400],
  leftOnline: true, leftAgeMs: 500, ...extra
});
test('empty telemetry has ten missing channels and unknown relay', () => {
  const v = T.view(null, now);
  assert.equal(v.online,false); assert.equal(v.avg,null); assert.equal(v.ssr,null);
  assert.deepEqual(v.s,Array(6).fill(null)); assert.deepEqual(v.h,Array(4).fill(null));
});
test('six DS and four DHT are mapped independently', () => {
  const v = T.view(sample(),now);
  assert.equal(v.complete,true); assert.equal(v.humidityComplete,true);
  assert.equal(v.avg,32.5); assert.equal(v.humidityAvg,75); assert.equal(v.leftOnline,true);
  assert.deepEqual(v.d,[31,32,33,34]);
});
test('invalid retained temperature excluded from average', () => {
  const v = T.view(sample({validMask:31, validCount:5, t6:99, avg:32}),now);
  assert.equal(v.s[5],null); assert.equal(v.avg,32); assert.equal(v.complete,false);
});
test('zero DS valid still permits DHT monitoring and relay status', () => {
  const v = T.view(sample({validMask:0, validCount:0, avg:null}),now);
  assert.equal(v.avg,null); assert.equal(v.validCount,0); assert.equal(v.humidityAvg,75); assert.equal(v.ssr,1);
});
test('missing RH is not zero and valid zero percent is preserved', () => {
  const v = T.view(sample({h1:0,h2:null,h3:undefined,humidityValidMask:3}),now);
  assert.deepEqual(v.h,[0,null,null,null]); assert.equal(v.humidityAvg,0);
});
test('stale snapshot cannot become live due to fresh Firebase server timestamp', () => {
  const v = T.view(sample({measuredTs:now-20000}),now);
  assert.equal(v.online,false); assert.equal(v.ssr,null); assert.equal(v.avg,null);
});
test('retained data expires without another Firebase event', () => {
  const raw = sample();
  assert.equal(T.view(raw,now).online,true);
  const v = T.view(raw,now+15000);
  assert.equal(v.online,false); assert.equal(v.validCount,0); assert.equal(v.humidityValidCount,0);
});
test('DS and DHT channel ages expire on their own schedules', () => {
  const v = T.view(sample({temperatureAgeMs:[3000,100,100,10000,500,500],humidityAgeMs:[7000,200,10000,400]}),now);
  assert.equal(v.s[0],null); assert.equal(v.s[3],null);
  assert.equal(v.h[0],null); assert.equal(v.h[2],null); assert.equal(v.validCount,4);
  assert.equal(v.avg,(31+32+34+35)/4);
});
test('partial legacy telemetry is accepted without inventing humidity', () => {
  const v = T.view({ts:now,n:3,t1:25,t2:26,t3:27,t4:-127,avg:26,ssr:0},now);
  assert.equal(v.legacy,true); assert.equal(v.validCount,3); assert.equal(v.avg,26);
  assert.equal(v.humidityAvg,null);
});
test('malformed and out-of-range values never become valid', () => {
  const v = T.view(sample({t1:'30',t2:-127,h1:101,h2:'80',d3:90}),now);
  assert.equal(v.s[0],null); assert.equal(v.s[1],null); assert.equal(v.h[0],null);
  assert.equal(v.h[1],null); assert.equal(v.d[2],null);
});
test('log rows normalize at measurement time instead of becoming stale today', () => {
  const row = T.logRow(sample({ts:now-60000,measuredTs:now-60000}));
  assert.equal(row.avg,32.5); assert.equal(row.humidityAvg,75); assert.equal(row.spray,1);
});
test('unreasonable future timestamp is not live', () => {
  assert.equal(T.view(sample({ts:now+60000,measuredTs:now+60000}),now).online,false);
});
test('aggregate THI uses six DS average and all four RH, ignoring companion DHT temperatures', () => {
  const v=T.view(sample({d1:0,d2:10,d3:20,d4:40,thi:999}),now);
  assert.equal(v.thiComplete,true); assert.equal(v.thi,SCS.thiOf(32.5,75));
});
test('missing or stale DS/RH blocks THI instead of calculating from partial averages', () => {
  for(const extra of [{validMask:31},{humidityValidMask:7},
    {humidityAgeMs:[7000,100,100,100]},{temperatureAgeMs:[3000,100,100,100,100,100]},
    {ts:now-16000,measuredTs:now-16000}]) {
    const v=T.view(sample(extra),now);
    assert.equal(v.thiComplete,false); assert.equal(v.thi,null);
  }
});
test('missing RH does not block temperature completeness', () => {
  const v=T.view(sample({humidityValidMask:0}),now);
  assert.equal(v.complete,true); assert.equal(v.avg,32.5); assert.equal(v.thi,null);
});
test('log THI is recalculated from valid measurement-time channels and preserves basis', () => {
  const r=T.logRow(sample({ts:now-60000,measuredTs:now-60000,controlBasis:'thi',controlPolicyVersion:2}));
  assert.equal(r.thi,SCS.thiOf(32.5,75)); assert.equal(r.controlBasis,'thi');
});
