import test from 'node:test';
import assert from 'node:assert/strict';
import {loadLobbyRank, parseLobbyLookup, createMemoryRiotCache, RiotError} from '../server/riot.js';
import {handleApi} from '../server/worker.js';

const raw = (queueId=420, participants=Array.from({length:10}, (_,i)=>({puuid:`player-${i}`}))) => ({metadata:{matchId:'OC1_987'}, info:{queueId,participants}});
function fixture(entries, match=raw()) {
  const calls=[];
  return {calls, get:async (route,path,ttl)=>{calls.push({route,path,ttl});return path.includes('/match/')?match:entries(Number(path.split('-').at(-1)));}};
}
test('lobby input validates platform against region and bounds match identifiers',()=>{
  assert.deepEqual(parseLobbyLookup({matchId:'OC1_987',region:'OCE'}),{matchId:'OC1_987',region:'oce'});
  for(const input of [null,[],{matchId:'EUW1_987',region:'oce'},{matchId:'OC1_1/evil',region:'oce'},{matchId:'OC1_'+'1'.repeat(30),region:'oce'},{matchId:'OC1_987',region:'toString'}]) assert.throws(()=>parseLobbyLookup(input));
});
test('average lobby rank uses solo entries, tier divisions and exactly ten bounded calls',async()=>{
 const c=fixture(i=>[{queueType:'RANKED_FLEX_SR',tier:'CHALLENGER',rank:'I'}, {queueType:'RANKED_SOLO_5x5',tier:i<5?'GOLD':'PLATINUM',rank:'II'}]);
 const {lobbyRank:r}=await loadLobbyRank({matchId:'OC1_987',region:'oce'},c);
 assert.equal(r.label,'Platinum IV');assert.equal(r.status,'available');assert.equal(r.rankedCount,10);assert.equal(r.basis,'current');assert.equal(r.queue,'RANKED_SOLO_5x5');assert.ok(!JSON.stringify(r).includes('player-'));
 assert.equal(c.calls.length,11);assert.equal(c.calls[0].route,'sea');assert.ok(c.calls.slice(1).every(c=>c.route==='oc1'&&c.path.startsWith('/lol/league/v4/entries/by-puuid/')&&c.ttl===300));
});
test('flex rank excludes unranked and unknown players and reports coverage',async()=>{
 const c=fixture(i=>i<2?[{queueType:'RANKED_FLEX_SR',tier:'EMERALD',rank:'III'}]:i<8?[]:null,raw(440));
 const {lobbyRank:r}=await loadLobbyRank({matchId:'OC1_987',region:'oce'},c);
 assert.equal(r.label,'Emerald III');assert.equal(r.status,'partial');assert.equal(r.rankedCount,2);assert.equal(r.unrankedCount,6);assert.equal(r.unknownCount,2);
});
test('normal queues never invent a lobby rank or request ranked entries',async()=>{
 const c=fixture(()=>[],raw(400));const {lobbyRank:r}=await loadLobbyRank({matchId:'OC1_987',region:'oce'},c);
 assert.equal(r.status,'unavailable');assert.equal(r.reason,'UNSUPPORTED_QUEUE');assert.equal(c.calls.length,1);
});
test('no ranked players, missing PUUIDs and duplicate participants are handled honestly',async()=>{
 const c=fixture(()=>[],raw(420,[{puuid:'player-0'},{puuid:'player-0'},{}]));
 const {lobbyRank:r}=await loadLobbyRank({matchId:'OC1_987',region:'oce'},c);
 assert.equal(c.calls.length,2);assert.equal(r.status,'unavailable');assert.equal(r.totalPlayers,3);assert.equal(r.unrankedCount,1);assert.equal(r.unknownCount,2);
 const many=fixture(()=>[],raw(420,Array.from({length:11},(_,i)=>({puuid:`player-${i}`}))));
 await assert.rejects(loadLobbyRank({matchId:'OC1_987',region:'oce'},many),e=>e.code==='RIOT_BAD_DATA');
});
test('apex tiers are ordered individually and missing/error entries are not unranked',async()=>{
 const c=fixture(()=>[{queueType:'RANKED_SOLO_5x5',tier:'GRANDMASTER',rank:'I'}]);
 assert.equal((await loadLobbyRank({matchId:'OC1_987',region:'oce'},c)).lobbyRank.label,'Grandmaster');
 const missing=fixture(()=>{throw new RiotError('RIOT_NOT_FOUND','missing',404);});
 assert.equal((await loadLobbyRank({matchId:'OC1_987',region:'oce'},missing)).lobbyRank.unknownCount,10);
});
test('429 or rejected credentials stop rank calls immediately',async()=>{
 for (const code of ['RIOT_RATE_LIMIT','RIOT_KEY_REJECTED']) {
 const c=fixture(()=>{throw new RiotError(code,'retry',code==='RIOT_RATE_LIMIT'?429:502,30);});
 await assert.rejects(loadLobbyRank({matchId:'OC1_987',region:'oce'},c),e=>e.code===code);assert.equal(c.calls.length,2);
 }
});
test('bounded local cache expires entries and returns reusable response copies',async()=>{
 let now=1000;const c=createMemoryRiotCache({maxEntries:2,now:()=>now});const req=id=>new Request(`http://localhost/${id}`);
 await c.put(req(1),Response.json({ok:1},{headers:{'Cache-Control':'public, max-age=2'}}));
 assert.deepEqual(await (await c.match(req(1))).json(),{ok:1});assert.deepEqual(await (await c.match(req(1))).json(),{ok:1});
 await c.put(req(2),Response.json({ok:2},{headers:{'Cache-Control':'max-age=2'}}));await c.put(req(3),Response.json({ok:3},{headers:{'Cache-Control':'max-age=2'}}));
 assert.equal(await c.match(req(1)),undefined);now=4000;assert.equal(await c.match(req(3)),undefined);
});
test('lobby rank API preserves authentication, origin and input boundaries',async()=>{
 const request=(body,headers={},method='POST')=>new Request('https://rank.test/api/lobby-rank',{method,headers:{'Content-Type':'application/json',...headers},...(['GET','HEAD'].includes(method)?{}:{body:JSON.stringify(body)})});
 const auth={'oai-authenticated-user-id':'owner'};const env={RIOT_API_KEY:'fixture-secret'};
 assert.equal((await handleApi(request({}),env)).status,401);
 assert.equal((await handleApi(request({}, {...auth,Origin:'https://evil.test'}),env)).status,403);
 assert.equal((await handleApi(request({},auth,'GET'),env)).status,405);
 assert.equal((await handleApi(request({matchId:'NA1_7',region:'oce'},auth),env)).status,400);
 const response=await handleApi(request({matchId:'OC1_987',region:'oce'},auth),env,{fetchImpl:async()=>Response.json(raw(400))});
 assert.equal(response.status,200);assert.equal((await response.json()).lobbyRank.reason,'UNSUPPORTED_QUEUE');
});
test('rank API caches successful snapshots and propagates Retry-After without exposing credentials',async()=>{
 const request=(origin,matchId,region)=>new Request(`https://${origin}/api/lobby-rank`,{method:'POST',headers:{'Content-Type':'application/json','oai-authenticated-user-id':'owner'},body:JSON.stringify({matchId,region})});
 let calls=0;const payload={...raw(),metadata:{matchId:'NA1_765'},info:{queueId:420,participants:[{puuid:'rank-player'}]}};
 const fetchImpl=async url=>{calls++;return Response.json(url.includes('/match/')?payload:[{queueType:'RANKED_SOLO_5x5',tier:'SILVER',rank:'IV'}]);};
 const env={RIOT_API_KEY:'fixture-secret'};
 for(let i=0;i<2;i++){
  const response=await handleApi(request('rank-cache.test','NA1_765','na'),env,{fetchImpl});
  assert.equal(response.status,200);assert.equal((await response.json()).lobbyRank.label,'Silver IV');
 }
 assert.equal(calls,2);
 const denied=await handleApi(request('rank-limit.test','KR_123','kr'),env,{fetchImpl:async()=>new Response('fixture-secret',{status:429,headers:{'Retry-After':'41'}})});
 assert.equal(denied.status,429);assert.equal(denied.headers.get('Retry-After'),'41');assert.ok(!(await denied.text()).includes('fixture-secret'));
});
test('unavailable reason distinguishes missing rank data from confirmed unranked lobby',async()=>{
 const input={matchId:'OC1_987',region:'oce'};
 const unranked=await loadLobbyRank(input,fixture(()=>[]));
 assert.equal(unranked.lobbyRank.reason,'NO_RANKED_PLAYERS');assert.equal(unranked.lobbyRank.unrankedCount,10);assert.equal(unranked.lobbyRank.unknownCount,0);
 for(const entries of [()=>null,()=>{throw new RiotError('RIOT_NOT_FOUND','missing',404);},()=>[{queueType:'RANKED_SOLO_5x5',tier:'INVALID',rank:'I'}],i=>i===0?null:[]]){
  const {lobbyRank:r}=await loadLobbyRank(input,fixture(entries));
  assert.equal(r.reason,'NO_RANK_DATA');assert.equal(r.status,'unavailable');assert.equal(r.rankedCount,0);assert.ok(r.unknownCount>0);
 }
});
