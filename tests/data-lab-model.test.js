import test from 'node:test';
import assert from 'node:assert/strict';
import {createLabSnapshot,createDemoLabSnapshot,exportLabSnapshot} from '../public/data-lab-model.js';
const history=(extra={})=>({schemaVersion:3,profile:{riotId:'Test#OCE',region:'OC1'},matches:[{id:'OC1_1',champion:'Ahri',role:'Mid',queue:'Ranked Solo',durationMinutes:20,kills:4,deaths:2,assists:6,cs:120,result:'Victory',isRemake:false,...extra}]});
const riot=()=>({metadata:{matchId:'OC1_2'},info:{gameDuration:1230,gameVersion:'16.18.1',gameStartTimestamp:1720000000000,queueId:420,mapId:11,participants:Array.from({length:10},(_,i)=>({puuid:`p${i}`,championName:'Ahri',teamPosition:i===0?'MIDDLE':'TOP',teamId:i<5?100:200,win:i<5,kills:4,deaths:2,assists:6,totalMinionsKilled:100,neutralMinionsKilled:23,goldEarned:10000,totalDamageDealtToChampions:20000,totalDamageTaken:12000,damageSelfMitigated:99999,totalHeal:500,totalDamageShieldedOnTeammates:100,visionScore:20,wardsPlaced:8,wardsKilled:2,detectorWardsPlaced:1,visionWardsBoughtInGame:2,gameEndedInEarlySurrender:false,item0:1001}))}});
test('Riot data preserves supported fields and converts seconds precisely without conflating damage',()=>{
 const snapshot=createLabSnapshot({rawMatches:[riot()],playerPuuid:'p0'},{source:'riot'});const r=snapshot.records[0];assert.equal(r.normalized.durationMinutes,20.5);assert.equal(r.normalized.cs,123);assert.equal(r.normalized.laneMinions,100);assert.equal(r.normalized.neutralMinions,23);assert.equal(r.normalized.damageTaken,12000);assert.equal(r.normalized.healing,500);assert.equal(r.normalized.shielding,100);assert.equal(r.normalized.role,'Mid');assert.equal(r.normalized.participants.length,10);assert.equal(r.metrics.damageShare.value,.2);assert.equal(r.source,'riot');assert.equal(r.completeness.timeline.status,'not_loaded');assert.equal(r.coaching.eligible,true);
});
test('missing fields stay null, explicit zeros survive and unknown role is not guessed',()=>{
 const r=createLabSnapshot(history({cs:0,kills:0,role:undefined})).records[0];assert.equal(r.normalized.cs,0);assert.equal(r.normalized.kills,0);assert.equal(r.normalized.damageTaken,null);assert.equal(r.normalized.role,null);assert.equal(r.coaching.eligible,false);assert.ok(r.coaching.reasons.includes('unknown_role'));assert.equal(r.completeness.basic.status,'partial');
});
test('remakes and unsupported queues remain inspectable but ineligible',()=>{
 for(const extra of [{isRemake:true},{queue:'ARAM Mayhem',queueId:2400},{durationMinutes:0},{durationMinutes:100}]) {const snapshot=createLabSnapshot(history(extra));assert.equal(snapshot.records.length,1);assert.equal(snapshot.records[0].coaching.eligible,false);}
});
test('snapshot import/export round trip recomputes metrics and never trusts incoming Riot source',()=>{
 const original=createLabSnapshot(history(),{collectedAt:'2026-09-27T00:00:00Z'});const exported=exportLabSnapshot(original);const parsed=typeof exported==='string'?JSON.parse(exported):exported;parsed.source='riot';parsed.records[0].source='riot';parsed.records[0].metrics.csPerMinute.value=999;const imported=createLabSnapshot(parsed);assert.equal(imported.source,'imported');assert.equal(imported.records[0].source,'imported');assert.equal(imported.records[0].metrics.csPerMinute.value,6);assert.deepEqual(imported.records[0].normalized,original.records[0].normalized);
});
test('safe raw projection excludes credentials, request headers, arbitrary notes and prototype properties',()=>{
 const data=history();data.apiKey='not-for-export';data.matches[0].notes='secret user note';data.headers={Authorization:'secret'};data.matches[0].authorization='secret';const snapshot=createLabSnapshot(data);const out=JSON.stringify(snapshot);assert.ok(!out.includes('not-for-export'));assert.ok(!out.includes('secret'));assert.ok(!out.includes('Authorization'));assert.throws(()=>createLabSnapshot(history({champion:'RGAPI-12345678-secret'})));
});
test('empty, duplicate, excessive snapshots and unmatched Riot player are rejected; demo deterministic count',()=>{
 assert.throws(()=>createLabSnapshot({matches:[]}));assert.throws(()=>createLabSnapshot({matches:Array(21).fill(history().matches[0])}));assert.throws(()=>createLabSnapshot({matches:Array(2).fill(history().matches[0])}));assert.throws(()=>createLabSnapshot({rawMatches:[riot()],playerPuuid:'missing'}));
 const demo=createDemoLabSnapshot(10);assert.equal(demo.records.length,10);assert.equal(demo.source,'demo');assert.equal(createLabSnapshot(exportLabSnapshot(demo)).source,'demo');assert.ok(demo.records.every(r=>r.source==='demo'));
});
test('per-metric missing CS or vision does not exclude independently available coaching evidence',()=>{
 const r=createLabSnapshot(history({cs:null,visionScore:null})).records[0];assert.equal(r.coaching.eligible,true);assert.equal(r.metrics.csPerMinute.value,null);assert.equal(r.metrics.kda.value,5);
});
test('history details provide actual participant fields and export preserves sanitized raw provenance',()=>{
 const data=history({cs:null});data.details={OC1_1:{gameVersion:'16.18.1',durationSeconds:1260,participants:[{champion:'Ahri',teamId:100,isPlayer:true,role:'Mid',goldEarned:12000,items:[1001,0]}]}};
 const original=structuredClone(data),snapshot=createLabSnapshot(JSON.stringify(data));assert.deepEqual(data,original);assert.equal(snapshot.records[0].normalized.durationMinutes,21);assert.equal(snapshot.records[0].normalized.goldEarned,12000);assert.equal(snapshot.records[0].raw.kind,'history');
 const restored=createLabSnapshot(exportLabSnapshot(createLabSnapshot({rawMatches:[riot()],playerPuuid:'p0'},{source:'riot'})));assert.equal(restored.source,'imported');assert.equal(restored.records[0].raw.kind,'riot');assert.equal(restored.records[0].metrics.damageShare.value,.2);
});
test('invalid structure, malformed raw fields and unsupported versions reject with safe errors',()=>{
 for(const value of ['{',null,4,{profile:[],matches:history().matches},{schemaVersion:99,matches:history().matches},{kind:'rift-review-data-lab',schemaVersion:2,records:[]},{matches:[null]}])assert.throws(()=>createLabSnapshot(value));
 const bad=riot();bad.info.participants[0]=null;assert.throws(()=>createLabSnapshot({rawMatches:[bad],playerPuuid:'p0'}),{name:'DataLabInputError'});
 assert.throws(()=>createDemoLabSnapshot(21));
 const missingRaw=exportLabSnapshot(createLabSnapshot(history()));missingRaw.records[0].raw={kind:'unavailable',data:null};assert.equal(createLabSnapshot(missingRaw).records[0].raw.data,null);
});
test('Riot early surrender is not mislabeled as a confirmed remake and short matches remain inspectable',()=>{
 const data=riot();data.info.participants[0].gameEndedInEarlySurrender=true;data.info.gameDuration=180;
 const r=createLabSnapshot({rawMatches:[data],playerPuuid:'p0'}).records[0];assert.equal(r.normalized.gameEndedInEarlySurrender,true);assert.equal(r.normalized.isRemake,null);assert.equal(r.coaching.eligible,false);assert.ok(r.coaching.reasons.includes('invalid_duration'));
});
test('legacy history without queue keeps Standard compatibility while explicit unsupported queues remain excluded',()=>{
 const {queue,...legacy}=history().matches[0];const old={...history(),schemaVersion:1,matches:[legacy]};
 const record=createLabSnapshot(old).records[0];assert.equal(record.normalized.queue,'Standard');assert.equal(record.coaching.eligible,true);assert.equal(Object.hasOwn(record.raw.data,'queue'),false);
 const unknown=createLabSnapshot(history({queue:undefined,queueId:9999})).records[0];assert.equal(unknown.normalized.queue,'Other');assert.equal(unknown.coaching.eligible,false);
 assert.equal(createLabSnapshot(history({queue:undefined,queueId:420})).records[0].normalized.queue,'Ranked Solo');
});
test('missing champion or result excludes coaching without removing the inspectable record',()=>{
 for(const extra of [{champion:null},{result:null},{result:'Unknown'}]) {const snapshot=createLabSnapshot(history(extra));assert.equal(snapshot.records.length,1);assert.equal(snapshot.records[0].coaching.eligible,false);assert.ok(snapshot.records[0].coaching.reasons.includes('missing_coaching_fields'));}
});
test('duplicate Riot participant identities cannot produce seemingly complete team shares',()=>{
 const data=riot();data.info.participants[2].puuid=data.info.participants[1].puuid;
 const record=createLabSnapshot({rawMatches:[data],playerPuuid:'p0'}).records[0];assert.equal(record.normalized.participants.length,10);assert.equal(record.metrics.damageShare.value,null);assert.equal(record.metrics.goldShare.value,null);assert.equal(record.metrics.killParticipation.value,null);assert.ok(record.completeness.supplementary.missingFields.includes('participants'));
 const restored=createLabSnapshot(exportLabSnapshot(createLabSnapshot({rawMatches:[data],playerPuuid:'p0'}))).records[0];assert.equal(restored.metrics.damageShare.value,null);
});
test('legacy history accepts numeric strings and case-insensitive roles/results without changing raw values',()=>{
 const source=history({durationMinutes:' 20.5 ',kills:'4',deaths:'2',assists:'6',cs:'123',visionScore:'0',teamKills:'20',goldEarned:'10000',damageToChampions:'20000',role:'mID',result:'vICTORY'});
 const r=createLabSnapshot(source).records[0];assert.equal(r.normalized.durationSeconds,1230);assert.equal(r.normalized.kills,4);assert.equal(r.normalized.cs,123);assert.equal(r.normalized.visionScore,0);assert.equal(r.normalized.role,'Mid');assert.equal(r.normalized.result,'Victory');assert.equal(r.coaching.eligible,true);assert.equal(r.metrics.csPerMinute.value,6);assert.equal(r.metrics.killParticipation.value,.5);assert.equal(r.raw.data.durationMinutes,' 20.5 ');assert.equal(r.raw.data.kills,'4');assert.equal(r.raw.data.role,'mID');assert.equal(r.raw.data.result,'vICTORY');
 const roundTrip=createLabSnapshot(exportLabSnapshot(createLabSnapshot(source))).records[0];assert.equal(roundTrip.normalized.cs,123);assert.equal(roundTrip.raw.data.durationMinutes,' 20.5 ');
});
test('history adapter preserves blank/null versus string zero without coercing Riot or snapshot data',()=>{
 for(const value of ['', '  ',null,undefined]) {const r=createLabSnapshot(history({cs:value,visionScore:value})).records[0];assert.equal(r.normalized.cs,null);assert.equal(r.normalized.visionScore,null);}
 const zero=createLabSnapshot(history({kills:'0',deaths:'0',cs:'0'})).records[0];assert.equal(zero.normalized.kills,0);assert.equal(zero.normalized.deaths,0);assert.equal(zero.normalized.cs,0);
 const data=riot();data.info.gameDuration='1230';data.info.participants[0].kills='4';const raw=createLabSnapshot({rawMatches:[data],playerPuuid:'p0'}).records[0];assert.equal(raw.normalized.durationSeconds,null);assert.equal(raw.normalized.kills,null);
 const snapshot=createLabSnapshot(history());snapshot.records[0].normalized.kills='4';snapshot.records[0].normalized.role='mid';snapshot.records[0].normalized.result='victory';const strict=createLabSnapshot(snapshot).records[0];assert.equal(strict.normalized.kills,null);assert.equal(strict.normalized.role,null);assert.equal(strict.normalized.result,null);
});
