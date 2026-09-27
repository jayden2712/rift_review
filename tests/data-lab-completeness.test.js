import test from 'node:test';
import assert from 'node:assert/strict';
import {calculateLabCompleteness} from '../public/data-lab-completeness.js';
import {calculateLabMetrics} from '../public/data-lab-metrics.js';
const normalized=(extra={})=>({champion:'Ahri',role:'Mid',queue:'Ranked Solo',result:'Victory',durationSeconds:1200,kills:4,deaths:0,assists:6,cs:120,goldEarned:10000,damageToChampions:18000,visionScore:15,teamKills:20,isRemake:null,gameEndedInEarlySurrender:false,participants:[],...extra});
const check=(n,raw={kind:'history',projection:true,provenance:'manual',data:{}})=>calculateLabCompleteness(n,raw,calculateLabMetrics(n));
const field=(c,name)=>c.fields.find(f=>f.field===name);
const original=(player={})=>({kind:'riot',projection:false,provenance:'riot_original',data:{info:{participants:[{puuid:'p1',...player}]}}});
const selected=(extra={})=>normalized({participants:[{puuid:'p1',isPlayer:true}],...extra});

test('unknown remake and a not-loaded timeline do not mark complete basic statistics as partial',()=>{
 const c=check(normalized());assert.equal(c.basic.status,'complete');assert.deepEqual(c.basic.missingFields,[]);assert.equal(c.status,undefined);assert.equal(c.remake.status,'unknown');assert.equal(c.remake.basis,'unavailable');assert.equal(c.remake.unknownPolicy,'allow_if_other_criteria_pass');assert.deepEqual(c.timeline,{status:'not_loaded'});assert.equal(field(c,'deaths').status,'available');
});

test('remake requires explicit isRemake and never infers from early surrender',()=>{
 for(const early of [true,false,null])assert.equal(check(normalized({gameEndedInEarlySurrender:early})).remake.status,'unknown');
 assert.equal(check(normalized({isRemake:true})).remake.status,'yes');assert.equal(check(normalized({isRemake:false})).remake.status,'no');assert.equal(check(normalized({isRemake:false})).remake.basis,'explicit');
});

test('original absent fields, known-invalid values and legacy projection omissions have distinct statuses',()=>{
 const n=selected({goldEarned:null,healing:null,visionScore:null});
 const raw=original({visionScore:-10});const c=check(n,raw);
 assert.equal(field(c,'goldEarned').status,'absent');assert.equal(field(c,'visionScore').status,'invalid');assert.equal(field(c,'healing').status,'absent');assert.ok(c.basic.missingFields.includes('goldEarned'));assert.ok(c.supplementary.missingFields.includes('healing'));
 const legacy=check(n,{...raw,projection:true,provenance:'riot_projection'});assert.equal(field(legacy,'goldEarned').status,'not_collected');assert.equal(field(legacy,'visionScore').status,'invalid');
});

test('manual omissions are not collected and explicit invalid values are diagnosed without guessing',()=>{
 const c=check(normalized({goldEarned:null,visionScore:null}),{kind:'history',projection:true,provenance:'manual',data:{visionScore:'bad'}});
 assert.equal(field(c,'goldEarned').status,'not_collected');assert.equal(field(c,'visionScore').status,'invalid');assert.deepEqual(field(c,'goldEarned').affects,['goldPerMinute','goldShare']);
 assert.equal(field(check(selected({healing:null}),original()),'healing').status,'absent');
 const unknownPlayer=normalized({healing:null,participants:[]});assert.equal(field(check(unknownPlayer,original()),'healing').status,'not_collected');
});

test('zero is valid, zero duration is invalid, and deaths-zero KDA does not mean missing input',()=>{
 const zeros=check(normalized({cs:0,goldEarned:0,visionScore:0,kills:0,assists:0,deaths:0,teamKills:0}));assert.equal(zeros.basic.status,'complete');assert.equal(field(zeros,'cs').status,'available');assert.equal(field(zeros,'teamKills').status,'available');
 const c=check(normalized({durationSeconds:0}),{kind:'history',projection:true,provenance:'manual',data:{durationSeconds:0}});assert.equal(field(c,'durationSeconds').status,'invalid');assert.ok(c.basic.missingFields.includes('durationSeconds'));
});

test('complete participant denominators satisfy team kills without inventing a normalized value',()=>{
 const participants=Array.from({length:10},(_,i)=>({puuid:`p${i}`,isPlayer:i===0,teamId:i<5?100:200,kills:4,goldEarned:10000,damageToChampions:18000}));
 const n=normalized({participants,teamId:100,teamKills:null});const c=check(n);assert.equal(field(c,'teamKills').status,'available');assert.equal(c.basic.status,'complete');assert.equal(n.teamKills,null);assert.equal(field(c,'participants').status,'available');
});

test('input remains immutable and unavailable source does not make claims about absent Riot fields',()=>{
 const n=normalized({visionScore:null}),raw={kind:'unavailable',data:null,projection:true,provenance:'unavailable'};const before=JSON.stringify({n,raw});const c=check(n,raw);assert.equal(field(c,'visionScore').status,'not_collected');assert.equal(JSON.stringify({n,raw}),before);assert.equal(field(c,'timeline').status,'not_collected');
});

test('a collected Riot team identifies absent or invalid teammate kills rather than uncollected team kills',()=>{
 const rows=Array.from({length:10},(_,i)=>({puuid:`p${i}`,teamId:i<5?100:200,isPlayer:i===0,kills:4,goldEarned:10000,damageToChampions:18000}));
 const rawRows=rows.map(({isPlayer,...p})=>p);
 for(const [value,status] of [[undefined,'absent'],[null,'absent'],[-1,'invalid'],['4','invalid']]){
  const sourceRows=rawRows.map((p,i)=>i===1?{...p,kills:value}:p);
  const n=normalized({teamId:100,teamKills:null,participants:rows.map((p,i)=>i===1?{...p,kills:null}:p)});
  const raw={kind:'riot',projection:false,provenance:'riot_original',data:{info:{participants:sourceRows}}};
  assert.equal(field(check(n,raw),'teamKills').status,status);
 }
});

test('missing original teammates are absent, projection omissions remain uncollected, and duplicate teams are invalid',()=>{
 const rows=Array.from({length:10},(_,i)=>({puuid:`p${i}`,teamId:i<5?100:200,isPlayer:i===0,kills:4}));
 const incomplete=rows.filter((_,i)=>i!==1),n=normalized({teamId:100,teamKills:null,participants:incomplete});
 const raw={kind:'riot',projection:false,provenance:'riot_original',data:{info:{participants:incomplete.map(({isPlayer,...p})=>p)}}};
 assert.equal(field(check(n,raw),'teamKills').status,'absent');
 assert.equal(field(check(n,raw),'participants').status,'absent');
 assert.equal(field(check(n,{...raw,projection:true,provenance:'riot_projection'}),'teamKills').status,'not_collected');
 const duplicate=rows.map((p,i)=>i===2?{...p,puuid:'p1'}:p);
 const duplicateRaw={...raw,data:{info:{participants:duplicate.map(({isPlayer,...p})=>p)}}};
 assert.equal(field(check(normalized({teamId:100,teamKills:null,participants:duplicate}),duplicateRaw),'teamKills').status,'invalid');
});

test('mapped Riot history false is unsupported remake inference rather than invalid raw data',()=>{
 const raw={kind:'history',projection:true,provenance:'riot_projection',data:{isRemake:false}};
 const c=check(normalized({isRemake:null}),raw);assert.equal(c.remake.status,'unknown');assert.equal(c.remake.basis,'unsupported_projection_inference');assert.equal(field(c,'isRemake').status,'not_collected');
 const manual=check(normalized({isRemake:false}),{...raw,provenance:'manual'});assert.equal(manual.remake.status,'no');assert.equal(manual.remake.basis,'explicit');assert.equal(field(manual,'isRemake').status,'available');
});
