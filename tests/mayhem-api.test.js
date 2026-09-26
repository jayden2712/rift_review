import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseLookup, mapRiotMatch, loadRiotHistory, createRiotClient, RiotError} from '../server/riot.js';
import * as riot from '../server/riot.js';
import {handleApi} from '../server/worker.js';
const base=JSON.parse(readFileSync(new URL('./fixtures/mayhem-match.json',import.meta.url)));
const puuid='fixture-mayhem-player';
const input={riotId:'Fixture#TEST',region:'oce',count:10,mode:'mayhem'};
function fixtureClient(ids=['OC1_240001'], detail=base) {
 const calls=[];
 return {calls,stats:()=>({networkRequests:calls.length,cacheHits:0}),async get(route,path) {
  calls.push({route,path});
  if(path.includes('/accounts/'))return {puuid,gameName:'Fixture',tagLine:'TEST'};
  if(path.includes('/summoners/'))return {puuid};
  if(path.includes('/ids?'))return ids;
  if(detail instanceof Error)throw detail;
  return typeof detail==='function'?detail(path):detail;
 }};
}
test('lookup validates mode and bounded pagination, keeping legacy defaults',()=>{
 assert.deepEqual(parseLookup({riotId:'A#B',region:'oce'}),{gameName:'A',tagLine:'B',region:'oce',count:20,mode:'sr',start:0});
 assert.equal(parseLookup({...input,start:480,count:20}).start,480);
 assert.equal(parseLookup({...input,start:490,count:10}).start,490);
 for(const values of [{mode:'aram'},{mode:'__proto__'},{start:-1},{start:1.5},{start:491},{start:490,count:20},{start:Infinity},{start:null},{mode:null}])assert.throws(()=>parseLookup({...input,...values}));
});
test('Mayhem maps exact queue without lane or map assumptions and keeps optional data unknown',()=>{
 const {match,detail}=mapRiotMatch({...base,info:{...base.info,mapId:99}},puuid,'OC1_240001','mayhem');
 assert.equal(match.queue,'ARAM Mayhem');assert.equal(match.role,null);assert.equal(match.durationMinutes,1033/60);assert.equal(match.visionScore,null);assert.equal(match.isRemake,null);
 assert.equal(detail.participants.length,10);assert.ok(detail.participants.every(p=>p.role===null&&p.augments===null));
 assert.deepEqual(detail.participants[0].summonerSpells,[4,32]);assert.deepEqual(detail.participants[0].items,[3089,0,3157,0,0,0,0]);
 assert.equal(typeof riot.mapRiotAugments,'function');assert.equal(riot.mapRiotAugments({playerAugment1:123}),null);
 for(const queueId of [450,420,9999])assert.ok(mapRiotMatch({...base,info:{...base.info,queueId}},puuid,'OC1_240001','mayhem').skipped);
 assert.ok(mapRiotMatch(base,puuid,'OC1_240001').skipped);
 assert.throws(()=>mapRiotMatch(base,'another-player','OC1_240001','mayhem'),e=>e.code==='PLAYER_MISMATCH');
 assert.throws(()=>mapRiotMatch(base,puuid,'OC1_999','mayhem'),e=>e.code==='RIOT_BAD_DATA');
});
test('short Mayhem stays visible; missing duration and core stats cannot become fabricated zeroes',()=>{
 assert.equal(mapRiotMatch({...base,info:{...base.info,gameDuration:110}},puuid,'OC1_240001','mayhem').detail.durationSeconds,110);
 assert.ok(mapRiotMatch({...base,info:{...base.info,gameDuration:undefined}},puuid,'OC1_240001','mayhem').skipped);
 assert.throws(()=>mapRiotMatch({...base,info:{...base.info,participants:base.info.participants.map((p,i)=>i===0?{...p,kills:null}:p)}},puuid,'OC1_240001','mayhem'),e=>e.code==='RIOT_BAD_DATA');
});
test('Mayhem history uses filtered IDs and carries stable identity, detail schema and cursor',async()=>{
 const client=fixtureClient(Array(10).fill('OC1_240001'));
 const out=await loadRiotHistory({...input,start:20},client);
 const request=new URL('https://example.test'+client.calls[2].path);
 assert.equal(request.searchParams.get('queue'),'2400');assert.equal(request.searchParams.get('start'),'20');assert.equal(request.searchParams.get('count'),'10');
 assert.equal(out.history.schemaVersion,3);assert.deepEqual(out.history.details,out.details);assert.equal(out.history.matches.length,1);
 assert.equal(out.source.mode,'mayhem');assert.equal(out.source.start,20);assert.equal(out.source.count,10);assert.equal(out.source.nextStart,30);assert.equal(out.source.hasMore,true);assert.equal(out.source.accountKey,'oc1:'+puuid);
});
test('empty initial history fails, while exhausted/filtered later pages preserve usable pagination',async()=>{
 await assert.rejects(loadRiotHistory(input,fixtureClient([])),e=>e.code==='NO_MATCHES');
 const empty=await loadRiotHistory({...input,start:10},fixtureClient([]));assert.equal(empty.history,null);assert.deepEqual(empty.details,{});assert.equal(empty.source.hasMore,false);assert.equal(empty.source.nextStart,10);
 const ids=Array(10).fill('OC1_240001');const missing=new RiotError('RIOT_NOT_FOUND','missing',404);
 await assert.rejects(loadRiotHistory(input,fixtureClient(ids,missing)),e=>e.code==='NO_SUPPORTED_MATCHES');
 const skipped=await loadRiotHistory({...input,start:10},fixtureClient(ids,missing));assert.equal(skipped.history,null);assert.equal(skipped.source.nextStart,20);assert.equal(skipped.source.hasMore,true);assert.equal(skipped.warnings.length,1);
 const final=await loadRiotHistory({...input,start:480,count:20},fixtureClient(Array(20).fill('OC1_240001')));assert.equal(final.source.nextStart,500);assert.equal(final.source.hasMore,false);
 const lastTen=await loadRiotHistory({...input,start:490,count:10},fixtureClient(Array(10).fill('OC1_240001')));assert.equal(lastTen.source.nextStart,500);assert.equal(lastTen.source.hasMore,false);
 await assert.rejects(loadRiotHistory({...input,start:10},fixtureClient(ids,new RiotError('RIOT_TIMEOUT','timeout'))),e=>e.code==='RIOT_TIMEOUT');
});
test('authentication, access denied and upstream timeout are distinct sanitized errors',async()=>{
 for(const [status,code] of [[401,'RIOT_AUTH_FAILED'],[403,'RIOT_ACCESS_DENIED']]){
  const client=createRiotClient({key:'fixture-secret',origin:'https://example.test',state:new Map(),fetchImpl:async()=>Response.json({message:'fixture-secret'},{status})});
  await assert.rejects(client.get('sea','/test'),e=>e.code===code&&!e.message.includes('fixture-secret'));
 }
 const client=createRiotClient({key:'fixture-secret',origin:'https://example.test',state:new Map(),fetchImpl:async()=>{throw new DOMException('timed out','TimeoutError');}});
 await assert.rejects(client.get('sea','/test'),e=>e.code==='RIOT_TIMEOUT');
});

test('Mayhem API returns browser-safe history while retaining origin/auth/input protection',async()=>{
 const calls=[];
 const fetchImpl=async(url,options)=>{
  calls.push(url);assert.equal(options.headers['X-Riot-Token'],'fixture-secret');
  if(url.includes('/accounts/'))return Response.json({puuid,gameName:'Fixture',tagLine:'TEST'});
  if(url.includes('/summoners/'))return Response.json({puuid});
  if(url.includes('/ids?'))return Response.json(['OC1_240001']);
  return Response.json(base);
 };
 const request=(body=input,headers={})=>new Request('https://mayhem.test/api/history',{method:'POST',headers:{'Content-Type':'application/json','oai-authenticated-user-id':'fixture-owner',...headers},body:JSON.stringify(body)});
 const deps={fetchImpl,cache:{match:async()=>undefined,put:async()=>{}}};
 const response=await handleApi(request(),{RIOT_API_KEY:'fixture-secret'},deps);
 assert.equal(response.status,200);assert.equal(response.headers.get('Cache-Control'),'private, no-store');
 const payload=await response.json();assert.equal(payload.history.matches[0].queue,'ARAM Mayhem');assert.equal(payload.history.schemaVersion,3);assert.equal(payload.history.details.OC1_240001.participants[0].augments,null);assert.equal(payload.source.hasMore,false);assert.ok(!JSON.stringify(payload).includes('fixture-secret'));
 const count=calls.length;
 for(const [req,status] of [[request({...input,mode:'unknown'}),400],[request({...input,start:491}),400],[request(input,{'Origin':'https://evil.test'}),403],[request(input,{'oai-authenticated-user-id':''}),401]])assert.equal((await handleApi(req,{RIOT_API_KEY:'fixture-secret'},deps)).status,status);
 assert.equal(calls.length,count);
});
test('malformed upstream page, duplicate exact player and mismatched detail IDs fail explicitly',async()=>{
 await assert.rejects(loadRiotHistory(input,fixtureClient(Array(11).fill('OC1_240001'))),e=>e.code==='RIOT_BAD_LIST');
 await assert.rejects(loadRiotHistory(input,fixtureClient(['invalid-id'])),e=>e.code==='RIOT_BAD_LIST');
 const doubled={...base,info:{...base.info,participants:[...base.info.participants,base.info.participants[0]]}};
 assert.throws(()=>mapRiotMatch(doubled,puuid,'OC1_240001','mayhem'),e=>e.code==='PLAYER_MISMATCH');
 await assert.rejects(loadRiotHistory(input,fixtureClient(['OC1_240001'],{...base,metadata:{matchId:'OC1_999'}})),e=>e.code==='RIOT_BAD_DATA');
});
