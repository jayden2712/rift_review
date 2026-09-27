import test from 'node:test';
import assert from 'node:assert/strict';
import {createLabSnapshot,exportLabSnapshot,replaceLabRecordRaw,getLabRecordPlayerPuuid,LAB_MAX_BYTES} from '../public/data-lab-model.js';
const dto=(id='OC1_123')=>({metadata:{matchId:id,dataVersion:'2',participants:Array.from({length:10},(_,i)=>`p${i}`)},futureRoot:{nested:[0,false,null,'  unchanged  ']},info:{gameDuration:1200,gameVersion:'16.18',gameStartTimestamp:1720000000000,queueId:420,mapId:11,teams:[{teamId:100,objectives:{baron:{first:true,kills:1}}}],futureInfo:{value:73},participants:Array.from({length:10},(_,i)=>({participantId:i+1,puuid:`p${i}`,riotIdGameName:`Player${i}`,riotIdTagline:'OCE',championName:'Ahri',teamPosition:'MIDDLE',teamId:i<5?100:200,win:i<5,kills:4,deaths:2,assists:6,totalMinionsKilled:100,neutralMinionsKilled:20,goldEarned:10000,totalDamageDealtToChampions:20000,totalDamageTaken:12000,totalHeal:500,totalDamageShieldedOnTeammates:100,visionScore:20,wardsPlaced:8,wardsKilled:2,detectorWardsPlaced:1,visionWardsBoughtInGame:2,gameEndedInEarlySurrender:false,item0:1001,item1:0,item2:0,item3:0,item4:0,item5:0,item6:3340,perks:{styles:[{style:8000,selections:[{perk:8005,var1:7}]}]},summoner1Id:4,summoner2Id:14,futureParticipant:{value:15}}))}});
const live=(raw=dto())=>createLabSnapshot({rawMatches:[raw],playerPuuid:'p0'},{source:'riot',collectedAt:'2026-10-01T00:00:00Z'});
const oldProjection=()=>{const current=live();return {...current,schemaVersion:1,records:current.records.map(r=>({...r,raw:{kind:'riot',projection:true,data:{metadata:r.raw.data.metadata,info:{...r.raw.data.info,teams:undefined,futureInfo:undefined}}}}))};};
test('original Riot body survives normalization and export/import exactly, detached and never trusted from normalized metrics',()=>{
 const raw=dto(),before=structuredClone(raw),snapshot=live(raw);assert.equal(snapshot.schemaVersion,2);assert.equal(snapshot.records[0].raw.projection,false);assert.equal(snapshot.records[0].raw.provenance,'riot_original');assert.deepEqual(raw,before);assert.deepEqual(snapshot.records[0].raw.data,before);assert.notEqual(snapshot.records[0].raw.data,raw);
 snapshot.records[0].normalized.cs=999;snapshot.records[0].metrics.csPerMinute.value=999;
 const reopened=createLabSnapshot(JSON.stringify(exportLabSnapshot(snapshot)));assert.equal(reopened.source,'imported');assert.equal(reopened.records[0].metrics.csPerMinute.value,6);assert.equal(reopened.records[0].raw.provenance,'riot_original');assert.deepEqual(reopened.records[0].raw.data,before);
});
test('schema 1 projections migrate without upgrading or recreating lost raw fields',()=>{
 const old=JSON.parse(JSON.stringify(oldProjection())),before=structuredClone(old);
 const migrated=createLabSnapshot(old);assert.equal(migrated.schemaVersion,2);assert.deepEqual(old,before);assert.equal(migrated.records[0].raw.projection,true);assert.equal(migrated.records[0].raw.provenance,'riot_projection');assert.deepEqual(migrated.records[0].raw.data,old.records[0].raw.data);assert.equal(migrated.records[0].raw.data.info.teams,undefined);
 assert.equal(createLabSnapshot(exportLabSnapshot(migrated)).records[0].raw.provenance,'riot_projection');
 const dishonest={...old,records:old.records.map(r=>({...r,raw:{...r.raw,projection:false,provenance:'riot_original'}}))};assert.equal(createLabSnapshot(dishonest).records[0].raw.projection,true);
});
test('unsafe original bodies are rejected rather than silently losing source fields',()=>{
 for(const extra of [{headers:{'x-riot-token':'hidden'}},{future:{api_key:'hidden'}},{future:{note:'RGAPI-do-not-store'}}]) {const raw={...dto(),...extra},before=structuredClone(raw);assert.throws(()=>live(raw),{name:'DataLabInputError'});assert.deepEqual(raw,before);}
 const cyclic=dto();cyclic.futureRoot=cyclic;assert.throws(()=>live(cyclic),{name:'DataLabInputError'});
});
test('targeted raw replacement changes only selected record and rejects identity or missing-player failures',()=>{
 const other=dto('OC1_124');const snapshot=JSON.parse(JSON.stringify(createLabSnapshot({rawMatches:[dto(),other],playerPuuid:'p0'},{source:'riot'})));const old={...snapshot,schemaVersion:1,records:snapshot.records.map(r=>({...r,raw:{...r.raw,projection:true}}))};const before=structuredClone(old);
 const fresh=dto();fresh.info.participants[0].totalMinionsKilled=200;
 const updated=replaceLabRecordRaw(old,'OC1_123',fresh);assert.deepEqual(old,before);assert.equal(updated.records[0].raw.provenance,'riot_original');assert.equal(updated.records[0].metrics.csPerMinute.value,11);assert.equal(updated.records[1].raw.provenance,'riot_projection');assert.deepEqual(updated.records[1].raw.data,old.records[1].raw.data);
 assert.throws(()=>replaceLabRecordRaw(old,'OC1_123',other));const absent=dto();absent.info.participants[0].puuid='someone-else';assert.throws(()=>replaceLabRecordRaw(old,'OC1_123',absent));assert.deepEqual(old,before);
});
test('old projection player identity resolves from exact Riot ID and never from row position or champion alone',()=>{
 const r=JSON.parse(JSON.stringify(oldProjection())).records[0];r.normalized.participants=r.normalized.participants.map(p=>({...p,puuid:null,participantId:null}));assert.equal(getLabRecordPlayerPuuid(r),'p0');
 const missing={...r,normalized:{...r.normalized,participants:r.normalized.participants.map(p=>({...p,riotId:null}))}};assert.throws(()=>getLabRecordPlayerPuuid(missing));
});
test('snapshot size limit uses UTF-8 bytes and is shared with the backend',()=>{
 assert.equal(LAB_MAX_BYTES,8*1024*1024);assert.throws(()=>createLabSnapshot(JSON.stringify({padding:'é'.repeat(LAB_MAX_BYTES/2)})),{name:'DataLabInputError'});
});
test('current Riot history remains a projection; manual and demo sources stay distinct',()=>{
 const matches=[{id:'OC1_123',champion:'Ahri',role:'Mid',result:'Victory',durationMinutes:20,kills:4,deaths:2,assists:6,cs:120}];
 const history=createLabSnapshot({matches},{source:'imported',historyProvenance:'riot_projection'});assert.equal(history.source,'imported');assert.equal(history.records[0].raw.kind,'history');assert.equal(history.records[0].raw.provenance,'riot_projection');assert.equal(history.records[0].raw.projection,true);assert.equal(createLabSnapshot(exportLabSnapshot(history)).records[0].raw.provenance,'riot_projection');
 assert.equal(createLabSnapshot({matches}).records[0].raw.provenance,'manual');assert.equal(createLabSnapshot({matches},{source:'demo'}).records[0].raw.provenance,'demo');
});
test('basic statistics remain complete independently of unknown remake and never equate early surrender with remake',()=>{
 const record=live().records[0];assert.equal(record.normalized.isRemake,null);assert.equal(record.normalized.gameEndedInEarlySurrender,false);assert.equal(record.completeness.basic.status,'complete');assert.equal(record.completeness.remake.status,'unknown');assert.equal(record.completeness.timeline.status,'not_loaded');assert.equal(record.coaching.eligible,true);assert.equal(record.coaching.unknownRemakePolicy,'allow_if_other_criteria_pass');assert.ok(record.coaching.limitations.includes('remake_status_unknown'));
});
test('refreshed record source survives save export while imported snapshots remain unverified',()=>{
 const old=JSON.parse(JSON.stringify(oldProjection()));const imported=createLabSnapshot(old);const updated=replaceLabRecordRaw(imported,'OC1_123',dto());const saved=exportLabSnapshot(updated);assert.equal(saved.source,'imported');assert.equal(saved.records[0].source,'riot');const reimported=createLabSnapshot(saved);assert.equal(reimported.records[0].source,'imported');assert.equal(reimported.records[0].raw.provenance,'riot_original');
});
test('credential-shaped extension fields and token strings reject without altering original JSON',()=>{
 for(const extension of [{'x-api-key':'private-value'},{privateKey:'private-value'},{debug:'Bearer abcdefghijklmnop'},{debug:'Basic dXNlcjpwYXNzd29yZA=='},{pem:'-----BEGIN PRIVATE KEY-----\nprivate'}])assert.throws(()=>live({...dto(),extension}),{name:'DataLabInputError'});
});
test('manual raw values retain invalid finite numbers so diagnostics distinguish invalid from missing',()=>{
 const snapshot=createLabSnapshot({matches:[{id:'manual-one',champion:'Ahri',role:'Mid',result:'Victory',durationMinutes:20,kills:4,deaths:2,assists:6,cs:-3}]});const record=snapshot.records[0];assert.equal(record.raw.data.cs,-3);assert.equal(record.normalized.cs,null);assert.equal(record.completeness.fields.find(field=>field.field==='cs').status,'invalid');
});
test('mapped Riot history remake flags are unavailable evidence while manual explicit flags remain authoritative',()=>{
 const matches=[{id:'OC1_123',champion:'Ahri',role:'Mid',result:'Victory',durationMinutes:20,kills:4,deaths:2,assists:6,cs:120,isRemake:false}];
 const snapshot=createLabSnapshot({matches},{historyProvenance:'riot_projection'}),record=snapshot.records[0];assert.equal(record.raw.data.isRemake,false);assert.equal(record.normalized.isRemake,null);assert.equal(record.completeness.remake.status,'unknown');assert.equal(record.coaching.eligible,true);assert.ok(record.coaching.limitations.includes('remake_status_unknown'));
 const mappedBeforeFix=structuredClone(snapshot);mappedBeforeFix.records[0].normalized.isRemake=false;
 const migrated=createLabSnapshot(mappedBeforeFix);assert.equal(migrated.records[0].normalized.isRemake,null);assert.equal(exportLabSnapshot(migrated).records[0].normalized.isRemake,null);assert.equal(migrated.records[0].raw.data.isRemake,false);
 for(const isRemake of [false,true]){const manual=createLabSnapshot({matches:matches.map(match=>({...match,isRemake}))}).records[0];assert.equal(manual.normalized.isRemake,isRemake);assert.equal(manual.completeness.remake.status,isRemake?'yes':'no');assert.equal(manual.coaching.eligible,!isRemake);}
});
