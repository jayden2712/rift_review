import test from 'node:test';
import assert from 'node:assert/strict';
import {timelineFixture,matchFixture} from './fixtures/lab-timeline.js';
import {createLabSnapshot,attachLabTimeline,updateLabTimelineState,exportLabSnapshot} from '../public/data-lab-model.js';
import {normalizeLabTimeline,timelineEvidence,LAB_TIMELINE_MAX_BYTES} from '../public/data-lab-timeline.js';
const snapshot=()=>createLabSnapshot({rawMatches:[matchFixture()],playerPuuid:'player'},{source:'riot'});
test('timeline uses identity mapping and actual timestamps, preserving zero and missing fields',()=>{
 const raw=timelineFixture();delete raw.info.frames[1].participantFrames['7'].xp;
 const result=normalizeLabTimeline(raw,snapshot().records[0]);
 assert.equal(result.participantId,7);assert.equal(result.frames[0].cs,0);assert.equal(result.frames[0].currentGold,0);assert.equal(result.frames[1].xp,null);
 assert.equal(result.checkpoints[0].actualTimestamp,570000);assert.equal(result.checkpoints[0].offsetMs,-30000);assert.equal(result.checkpoints[0].cs,60);
 assert.equal(result.events.length,2);assert.notEqual(result.events[0].id,result.events[1].id);assert.equal(result.events[0].playerRole,'death');
});
test('timeline rejects wrong match and ambiguous or inconsistent mappings',()=>{
 const r=snapshot().records[0];
 for(const mutate of [x=>x.metadata.matchId='OC1_1',x=>x.info.participants.push({participantId:7,puuid:'third'}),x=>x.info.participants[0].puuid='player',x=>x.info.participants[1].participantId=8,x=>x.info.frames[0].participantFrames['7'].participantId=8]){
 const raw=timelineFixture();mutate(raw);assert.throws(()=>normalizeLabTimeline(raw,r));
 }
 assert.throws(()=>normalizeLabTimeline(timelineFixture(),{...r,normalized:{...r.normalized,mapId:12}}));
});
test('missing frame and game ended before target produce null with reason and no interpolation',()=>{
 const r=snapshot().records[0],raw=timelineFixture();raw.info.frames=raw.info.frames.filter(f=>f.timestamp!==570000);
 const n=normalizeLabTimeline(raw,{...r,normalized:{...r.normalized,durationSeconds:1100}});
 assert.equal(n.checkpoints[0].cs,null);assert.equal(n.checkpoints[0].reason,'no_frame_within_tolerance');assert.equal(n.checkpoints[2].reason,'ended_before_target');assert.equal(n.checkpoints[2].actualTimestamp,null);
});
test('raw timeline round trip recomputes derived data and imports remain unverified',()=>{
 const raw=timelineFixture(),loaded=attachLabTimeline(snapshot(),'OC1_99',raw,{collectedAt:'2026-10-05T00:00:00Z'});
 assert.deepEqual(loaded.records[0].timeline.raw,raw);assert.equal(loaded.schemaVersion,3);assert.equal(loaded.records[0].completeness.timeline.status,'loaded');
 assert.equal(exportLabSnapshot(loaded).records[0].timeline.provenance,'riot_original');
 const forged=structuredClone(loaded);forged.records[0].timeline.normalized.frames[0].cs=999;
 const imported=createLabSnapshot(JSON.stringify(forged));assert.equal(imported.records[0].timeline.normalized.frames[0].cs,0);assert.equal(imported.records[0].timeline.provenance,'imported');
 for(const schemaVersion of [1,2]){const old={...snapshot(),schemaVersion};delete old.records[0].timeline;assert.equal(createLabSnapshot(old).records[0].timeline.status,'not_loaded');}
});
test('all retry failures preserve full previous timeline and expose last error',()=>{
 const loaded=attachLabTimeline(snapshot(),'OC1_99',timelineFixture());
 for(const code of ['RIOT_ACCESS_DENIED','RIOT_NOT_FOUND','RIOT_RATE_LIMIT','RIOT_TIMEOUT']){
 const failed=updateLabTimelineState(loaded,'OC1_99',{status:code==='RIOT_NOT_FOUND'?'unavailable':'error',lastError:{code,message:'Cannot fetch timeline',retryable:true}});
 assert.deepEqual(failed.records[0].timeline.raw,loaded.records[0].timeline.raw);assert.equal(failed.records[0].timeline.lastError.code,code);
 }
 assert.equal(loaded.records[0].timeline.status,'loaded');
});
test('evidence is compact, deterministic and backed by actual frame fields or death events',()=>{
 const loaded=attachLabTimeline(snapshot(),'OC1_99',timelineFixture()),r=loaded.records[0],e=timelineEvidence(r);
 assert.deepEqual(e,timelineEvidence(r));assert.equal(e.find(x=>x.kind==='cs_delta').value,60);assert.equal(e.find(x=>x.kind==='gold_delta').value,4000);assert.equal(e.find(x=>x.kind==='player_death').timestamp,600001);
 assert.ok(e.every(x=>x.id&&x.matchId&&x.participantId===7&&x.sourceFields.length&&x.formula&&x.limitations.length));assert.ok(!JSON.stringify(e).includes('participantFrames":'));
});
test('timeline raw size is bounded independently without truncating or mutating prior snapshot',()=>{
 const previous=snapshot(),raw={...timelineFixture(),extra:'a'.repeat(LAB_TIMELINE_MAX_BYTES)};
 assert.throws(()=>attachLabTimeline(previous,'OC1_99',raw),/2 MiB/);assert.equal(previous.records[0].timeline.status,'not_loaded');
});
test('every timeline collection state round-trips without promoting imported provenance',()=>{
 for(const status of ['not_loaded','loading','error','unavailable']){
  const state=updateLabTimelineState(snapshot(),'OC1_99',{status,lastError:status==='error'?{code:'RIOT_TIMEOUT',status:504,retryable:true}:null});
  const restored=createLabSnapshot(exportLabSnapshot(state));assert.equal(restored.records[0].timeline.status,status);assert.equal(restored.records[0].timeline.raw,null);
 }
 const loaded=attachLabTimeline(snapshot(),'OC1_99',timelineFixture());
 const loading=updateLabTimelineState(loaded,'OC1_99',{status:'loading'});
 assert.deepEqual(createLabSnapshot(exportLabSnapshot(loading)).records[0].timeline.raw,timelineFixture());
});
test('unknown error fields and unsafe raw credentials cannot escape into snapshot',()=>{
 const state=updateLabTimelineState(snapshot(),'OC1_99',{status:'error',lastError:{code:'RGAPI_SECRET_TOKEN',message:'RGAPI-secret',headers:{Authorization:'secret'},retryable:true}});
 assert.equal(state.records[0].timeline.lastError.code,'TIMELINE_ERROR');assert.ok(!JSON.stringify(state).includes('secret'));
 for(const extra of [{headers:{'X-Riot-Token':'secret'}},{unknown:'RGAPI-secret'}])assert.throws(()=>attachLabTimeline(snapshot(),'OC1_99',{...timelineFixture(),...extra}));
});
test('all frame statistics preserve numeric zero and reject missing or invalid components',()=>{
 const raw=timelineFixture();raw.info.frames[0].participantFrames['7']={participantId:7,minionsKilled:0,totalGold:0,currentGold:0,xp:0,level:0};
 const n=normalizeLabTimeline(raw,snapshot().records[0]);assert.equal(n.frames[0].cs,null);
 for(const field of ['totalGold','currentGold','xp','level'])assert.equal(n.frames[0][field],0);
 const r={...snapshot().records[0],timeline:{normalized:n,provenance:'imported'}};
 assert.ok(!timelineEvidence(r).some(e=>e.kind==='cs_delta'&&e.fromTimestamp===0));assert.ok(timelineEvidence(r).every(e=>e.limitations.includes('imported_unverified')));
});
test('tolerance is inclusive and missing duration never invents checkpoint statistics',()=>{
 const raw=timelineFixture();raw.info.frames[1].timestamp=540000;
 assert.equal(normalizeLabTimeline(raw,snapshot().records[0]).checkpoints[0].actualTimestamp,540000);
 raw.info.frames[1].timestamp=539999;
 assert.equal(normalizeLabTimeline(raw,snapshot().records[0]).checkpoints[0].actualTimestamp,null);
 const r=snapshot().records[0];assert.ok(normalizeLabTimeline(raw,{...r,normalized:{...r.normalized,durationSeconds:null}}).checkpoints.every(c=>c.reason==='unknown_duration'));
});
test('eight MiB total budget includes attached raw and derived timeline without altering old data',()=>{
 const match={...matchFixture(),padding:'x'.repeat(7*1024*1024)},s=createLabSnapshot({rawMatches:[match],playerPuuid:'player'},{source:'riot'});
 const raw={...timelineFixture(),extension:'x'.repeat(1500*1024)};
 assert.throws(()=>attachLabTimeline(s,'OC1_99',raw),/8 MiB/);assert.equal(s.records[0].timeline.status,'not_loaded');assert.equal(s.records[0].raw.data.padding.length,7*1024*1024);
});
test('a selected participant absent from a real frame has explicit checkpoint absence, not zero',()=>{
 const raw=timelineFixture();raw.info.frames[1].participantFrames={};
 const checkpoint=normalizeLabTimeline(raw,snapshot().records[0]).checkpoints[0];
 assert.equal(checkpoint.reason,'participant_frame_missing');assert.equal(checkpoint.actualTimestamp,570000);assert.equal(checkpoint.cs,null);assert.equal(checkpoint.totalGold,null);
});
