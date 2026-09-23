import test from 'node:test';
import assert from 'node:assert/strict';
import {parseLookup,createRiotClient,mapRiotMatch,loadRiotHistory} from '../server/riot.js';
import {handleApi} from '../server/worker.js';
import {normalizeHistory} from '../public/history-data.js';
const puuid='fixture-player';
function rawMatch(id='OC1_123'){
  const participants=Array.from({length:10},(_,i)=>({puuid:i===2?puuid:`fixture-${i}`,teamId:i<5?100:200,championName:i===2?'Ahri':'Garen',teamPosition:['TOP','JUNGLE','MIDDLE','BOTTOM','UTILITY'][i%5],win:i<5,kills:i===2?6:4,deaths:3,assists:5,totalMinionsKilled:170,neutralMinionsKilled:10,visionScore:22,totalDamageDealtToChampions:21000,goldEarned:12500,riotIdGameName:i===2?'not tày enough':'Fixture',riotIdTagline:i===2?'idc':String(i)}));
  return {metadata:{matchId:id},info:{participants,mapId:11,queueId:420,gameDuration:1800,gameStartTimestamp:1789380000000,gameVersion:'16.18.1'}};
}
function clientFixture(fetchImpl,cache=null){let clock=1000000;return createRiotClient({key:'fixture-secret',origin:'https://example.test',cache,fetchImpl,state:new Map(),now:()=>clock,sleep:async ms=>clock+=ms});}

test('Riot ID accents and spaces are preserved; untrusted regions and oversized counts rejected',()=>{
 assert.deepEqual(parseLookup({riotId:'not tày enough#idc',region:'OCE'}),{gameName:'not tày enough',tagLine:'idc',region:'oce',count:20});
 for(const input of [{riotId:'Name',region:'oce'},{riotId:'A#B',region:'evil.test'},{riotId:'A#B',region:'oce',count:100},{riotId:'A#B#C',region:'oce'}])assert.throws(()=>parseLookup(input));
});
test('mapping selects the exact PUUID and includes correct CS, team kills and both teams',()=>{
 const result=mapRiotMatch(rawMatch(),puuid,'OC1_123');assert.equal(result.match.champion,'Ahri');assert.equal(result.match.cs,180);assert.equal(result.match.teamKills,22);assert.equal(result.match.role,'Mid');assert.equal(result.match.durationMinutes,30);
 assert.equal(result.detail.participants.length,10);assert.equal(result.detail.participants.filter(p=>p.isPlayer).length,1);assert.equal(normalizeHistory({matches:[result.match]}).matches.length,1);
 assert.throws(()=>mapRiotMatch(rawMatch(),'different-player','OC1_123'));
 assert.throws(()=>mapRiotMatch(rawMatch(),puuid,'OC1_999'));
});
test('unknown optional stats remain null and unsupported modes/short games are excluded',()=>{
 const raw=rawMatch();delete raw.info.participants[2].neutralMinionsKilled;delete raw.info.participants[2].visionScore;const mapped=mapRiotMatch(raw,puuid,'OC1_123');assert.equal(mapped.match.cs,null);assert.equal(mapped.match.visionScore,null);
 raw.info.queueId=450;assert.ok(mapRiotMatch(raw,puuid,'OC1_123').skipped);raw.info.queueId=420;raw.info.gameDuration=180;assert.ok(mapRiotMatch(raw,puuid,'OC1_123').skipped);
});
test('Riot lookup uses ACCOUNT Asia, OCE platform and SEA match routing with encoded Riot ID',async()=>{
 const calls=[];const client=clientFixture(async (url,options)=>{calls.push({url,options});if(url.includes('/accounts/'))return Response.json({puuid,gameName:'not tày enough',tagLine:'idc'});if(url.includes('/summoner/'))return Response.json({puuid});if(url.includes('/ids?'))return Response.json(['OC1_123','OC1_123']);return Response.json(rawMatch());});
 const out=await loadRiotHistory({riotId:'not tày enough#idc',region:'oce',count:20},client);
 assert.ok(calls[0].url.includes('/not%20t%C3%A0y%20enough/idc'));assert.ok(calls[0].url.startsWith('https://asia.api.riotgames.com/'));assert.ok(calls[1].url.startsWith('https://oc1.api.riotgames.com/'));assert.ok(calls[2].url.startsWith('https://sea.api.riotgames.com/'));
 assert.equal(out.history.matches.length,1);assert.equal(out.history.profile.region,'OCE');assert.ok(calls.every(c=>c.options.headers['X-Riot-Token']==='fixture-secret'));assert.ok(!JSON.stringify(out).includes('fixture-secret'));
});
test('successful cache hits avoid repeated calls; cached responses contain no API headers',async()=>{
 const saved=new Map();let n=0;const cache={match:async request=>saved.get(request.url)?.clone(),put:async(request,response)=>saved.set(request.url,response.clone())};const c=clientFixture(async()=>{n++;return Response.json({hello:'world'});},cache);
 await c.get('asia','/test',600);await c.get('asia','/test',600);assert.equal(n,1);assert.equal(c.stats().cacheHits,1);assert.equal([...saved.values()][0].headers.get('X-Riot-Token'),null);
});
test('429 honors Retry-After and prevents subsequent calls during the cooldown',async()=>{
 let calls=0;const c=clientFixture(async()=>{calls++;return new Response('',{status:429,headers:{'Retry-After':'37'}});});
 await assert.rejects(c.get('sea','/one'),e=>e.code==='RIOT_RATE_LIMIT'&&e.retryAfter===37);
 await assert.rejects(c.get('sea','/two'),e=>e.code==='RIOT_RATE_LIMIT'&&e.retryAfter===37);assert.equal(calls,1);
});
test('API rejects unsigned and cross-origin callers before using any credential',async()=>{
 let calls=0;const deps={fetchImpl:async()=>{calls++;return Response.json({});}};
 const req=(headers={})=>new Request('https://example.test/api/history',{method:'POST',headers:{'Content-Type':'application/json',...headers},body:'{}'});
 assert.equal((await handleApi(req(),{RIOT_API_KEY:'fixture-secret'},deps)).status,401);
 assert.equal((await handleApi(req({'oai-authenticated-user-id':'owner','Origin':'https://evil.test'}),{RIOT_API_KEY:'fixture-secret'},deps)).status,403);assert.equal(calls,0);
});
test('missing and rejected keys produce actionable sanitized responses',async()=>{
 const request=()=>new Request('https://example.test/api/history',{method:'POST',headers:{'Content-Type':'application/json','oai-authenticated-user-id':'owner'},body:JSON.stringify({riotId:'not tày enough#idc',region:'oce'})});
 const missing=await handleApi(request(),{});assert.equal(missing.status,503);assert.equal((await missing.json()).error.code,'RIOT_NOT_CONFIGURED');
 const rejected=await handleApi(request(),{RIOT_API_KEY:'fixture-secret'},{fetchImpl:async()=>Response.json({message:'fixture-secret'},{status:403})});const text=await rejected.text();assert.ok(text.includes('RIOT_KEY_REJECTED'));assert.ok(!text.includes('fixture-secret'));
});
test('match detail preserves seconds and loadout IDs, distinguishing empty and missing slots',()=>{
 const base=rawMatch();const p={...base.info.participants[2],champLevel:16,summoner1Id:4,summoner2Id:14,item0:3157,item1:0,item2:3089,item6:3363,perks:{styles:[{description:'primaryStyle',style:8100,selections:[{perk:8112},{perk:8139},{perk:8138},{perk:8106}]},{description:'subStyle',style:8200,selections:[{perk:8226},{perk:8210}]}],statPerks:{offense:5008,flex:5008,defense:5001}}};
 const source={...base,info:{...base.info,gameDuration:1873,participants:base.info.participants.map((v,i)=>i===2?p:v)}};
 const {detail}=mapRiotMatch(source,puuid,'OC1_123');const player=detail.participants.find(v=>v.isPlayer);
 assert.equal(detail.durationSeconds,1873);assert.equal(player.championLevel,16);assert.deepEqual(player.summonerSpells,[4,14]);assert.deepEqual(player.items,[3157,0,3089,null,null,null,3363]);
 assert.deepEqual(player.runes,{primaryStyle:8100,secondaryStyle:8200,primary:[8112,8139,8138,8106],secondary:[8226,8210],shards:[5008,5008,5001]});
 const unknown=detail.participants.find(v=>!v.isPlayer);assert.equal(unknown.championLevel,null);assert.deepEqual(unknown.summonerSpells,[null,null]);assert.equal(unknown.runes,null);
});
