import test from 'node:test';
import assert from 'node:assert/strict';
import {loadLobbyRank} from '../public/riot-source.js';
const rank={status:'partial',label:'GOLD II',tier:'GOLD',rankedCount:8,totalPlayers:10,basis:'current',queue:'RANKED_SOLO_5x5'};
test('lobby rank adapter submits only lookup parameters and validates rank coverage',async()=>{
  const out=await loadLobbyRank({matchId:'OC1_123',region:'oce'},{fetchImpl:async(url,options)=>{
    assert.equal(url,'/api/lobby-rank');
    assert.deepEqual(JSON.parse(options.body),{matchId:'OC1_123',region:'oce'});
    return Response.json({lobbyRank:rank});
  }});
  assert.deepEqual(out,rank);
  for(const invalid of [{...rank,totalPlayers:500},{...rank,rankedCount:11},{...rank,basis:'historical'},{...rank,label:{}},null]){
    await assert.rejects(loadLobbyRank({}, {fetchImpl:async()=>Response.json({lobbyRank:invalid})}),e=>e.code==='BAD_RESPONSE');
  }
});
test('rank failures preserve retry information and remain isolated from history',async()=>{
  await assert.rejects(loadLobbyRank({}, {fetchImpl:async()=>Response.json({error:{code:'RIOT_RATE_LIMIT',message:'Đợi',retryAfter:30}},{status:429})}),e=>e.code==='RIOT_RATE_LIMIT'&&e.retryAfter===30);
  await assert.rejects(loadLobbyRank({}, {fetchImpl:async()=>{throw Error('offline');}}),e=>e.code==='NETWORK_ERROR');
  await assert.rejects(loadLobbyRank({}, {fetchImpl:async()=>new Response('<html>')}),e=>e.code==='BAD_RESPONSE');
});
