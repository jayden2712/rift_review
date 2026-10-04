import {RiotError,createRiotClient} from './riot.js';
import {createLabSnapshot,attachLabTimeline,updateLabTimelineState,getLabRecordPlayerPuuid} from '../public/data-lab-model.js';
import {matchRegion,labFailure} from './data-lab-collection.js';

export async function loadLabTimeline(input,url,env,cache,fetchImpl){
 const region=matchRegion(input?.matchId,input?.region);
 const snapshot=createLabSnapshot(input?.snapshot,{source:'imported'});
 const record=snapshot.records.find(entry=>entry.matchId===input.matchId);
 if(!record)throw new RiotError('INVALID_MATCH','Trận phải thuộc snapshot hiện tại.',400);
 if(record.normalized.mapId!==11)throw new RiotError('LAB_TIMELINE_SR_ONLY','Timeline chỉ hỗ trợ Summoner’s Rift.',400);
 try{getLabRecordPlayerPuuid(record);}
 catch{throw new RiotError('LAB_PLAYER_UNKNOWN','Snapshot chưa có định danh người chơi phù hợp cho timeline.',400);}
 const lastAttemptAt=new Date().toISOString();
 try{
  const client=createRiotClient({key:env.RIOT_API_KEY,origin:new URL(url).origin,cache,fetchImpl});
  const raw=await client.get(region.routing,`/lol/match/v5/matches/${encodeURIComponent(input.matchId)}/timeline`,86400);
  return attachLabTimeline(snapshot,input.matchId,raw,{collectedAt:lastAttemptAt});
 }catch(error){
  const safe=error instanceof RiotError?error:new RiotError('INVALID_LAB_DATA','Timeline không hợp lệ, không khớp trận/người chơi hoặc vượt giới hạn dung lượng.',400);
  const state={status:safe.code==='RIOT_NOT_FOUND'?'unavailable':'error',lastAttemptAt,lastError:{...labFailure(safe),...(safe.code==='RIOT_NOT_CONFIGURED'?{code:safe.code,retryable:false}:{}),message:safe.message}};
  // Error attempts are returned for inspection, never saved over a valid file.
  safe.snapshot=updateLabTimelineState(snapshot,input.matchId,state);
  throw safe;
 }
}
