import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readdir,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createDataLab} from '../server/data-lab.js';
import {createLabSnapshot,attachLabTimeline} from '../public/data-lab-model.js';
import {matchFixture,timelineFixture} from './fixtures/lab-timeline.js';
const snapshot=()=>createLabSnapshot({rawMatches:[matchFixture()],playerPuuid:'player'},{source:'riot'});
async function setup(t,fetchImpl){
 const directory=await mkdtemp(join(tmpdir(),'lab-timeline-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const handler=createDataLab({directory,env:{RIOT_API_KEY:'fixture-private'},fetchImpl});
 return {directory,post:async input=>{const response=await handler(new Request('http://localhost/api/lab/timeline',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)}));return {status:response.status,body:await response.json()};}};
}
test('one requested SR timeline uses regional Riot client and saves raw without headers',async t=>{
 const calls=[];const app=await setup(t,async(url,options)=>{calls.push({url,key:options.headers['X-Riot-Token']});return Response.json(timelineFixture());});
 const result=await app.post({snapshot:snapshot(),matchId:'OC1_99',region:'oce'});
 assert.equal(result.status,201);assert.deepEqual(calls,[{url:'https://sea.api.riotgames.com/lol/match/v5/matches/OC1_99/timeline',key:'fixture-private'}]);
 assert.deepEqual(result.body.snapshot.records[0].timeline.raw,timelineFixture());
 const stored=JSON.parse(await readFile(join(app.directory,result.body.id+'.json'),'utf8'));assert.deepEqual(stored,result.body.snapshot);
 assert.ok(!JSON.stringify(result.body).includes('fixture-private'));
});
test('timeline rejects nonmembership, nonSR and routing mismatch before network',async t=>{
 let calls=0;const app=await setup(t,async()=>{calls++;return Response.json(timelineFixture());});
 for(const input of [{snapshot:snapshot(),matchId:'OC1_100'},{snapshot:snapshot(),matchId:'OC1_99',region:'na'},
 {snapshot:createLabSnapshot({rawMatches:[{...matchFixture(),info:{...matchFixture().info,mapId:12}}],playerPuuid:'player'}),matchId:'OC1_99'}]){
  assert.equal((await app.post(input)).status,400);
 }
 assert.equal(calls,0);
});
test('invalid timeline identity and oversized body retain valid raw and create no file',async t=>{
 const previous=attachLabTimeline(snapshot(),'OC1_99',timelineFixture(),{collectedAt:'2026-10-01T00:00:00Z'});
 const bad=[{...timelineFixture(),metadata:{matchId:'OC1_100'}},{...timelineFixture(),info:{...timelineFixture().info,participants:[{participantId:7,puuid:'other'}]}},{...timelineFixture(),oversize:'x'.repeat(2*1024*1024)}];
 for(const payload of bad){
  const app=await setup(t,async()=>Response.json(payload));const result=await app.post({snapshot:previous,matchId:'OC1_99'});
  assert.equal(result.status,400);assert.deepEqual(result.body.snapshot.records[0].timeline.raw,timelineFixture());
  assert.deepEqual(await readdir(app.directory),[]);
 }
});
test('timeline addition respects the combined 8 MiB limit without truncating a large match body',async t=>{
 const large=createLabSnapshot({rawMatches:[{...matchFixture(),retainedBody:'x'.repeat(7*1024*1024)}],playerPuuid:'player'},{source:'riot'});
 const payload={...timelineFixture(),extension:'x'.repeat(1536*1024)};
 const app=await setup(t,async()=>Response.json(payload));
 const result=await app.post({snapshot:large,matchId:'OC1_99'});assert.equal(result.status,400);
 assert.equal(result.body.snapshot.records[0].raw.data.retainedBody.length,7*1024*1024);
 assert.equal(result.body.snapshot.records[0].timeline.raw,null);assert.deepEqual(await readdir(app.directory),[]);
});
test('404, 403, timeout and 429 preserve previously valid timeline and return safe last attempt',async t=>{
 const previous=attachLabTimeline(snapshot(),'OC1_99',timelineFixture(),{collectedAt:'2026-10-01T00:00:00Z'});
 // Rate limit last: client intentionally shares route cooldown across handlers.
 for(const scenario of [404,403,'timeout',429]){
  const app=await setup(t,async()=>{if(scenario==='timeout')throw Object.assign(new Error('fixture-private'),{name:'TimeoutError'});return new Response('fixture-private',{status:scenario,headers:{'Retry-After':'1'}});});
  const result=await app.post({snapshot:previous,matchId:'OC1_99'});assert.ok(result.status>=400);
  const timeline=result.body.snapshot.records[0].timeline;
  assert.deepEqual(timeline.raw,timelineFixture());assert.ok(timeline.lastAttemptAt);assert.ok(timeline.lastError.code);
  assert.equal(timeline.status,scenario===404?'unavailable':'error');assert.ok(!JSON.stringify(result.body).includes('fixture-private'));
  assert.deepEqual(await readdir(app.directory),[]);
 }
});
