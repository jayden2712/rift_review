import {RiotError,RIOT_REGIONS,parseLookup,createRiotClient} from './riot.js';
import {createLabSnapshot,exportLabSnapshot,getLabRecordPlayerPuuid} from '../public/data-lab-model.js';
import {LAB_COLLECTION_CODES} from '../public/data-lab-collection.js';
const globalCodes=new Set(['RIOT_AUTH_FAILED','RIOT_ACCESS_DENIED','RIOT_RATE_LIMIT','LOCAL_RATE_LIMIT','LOOKUP_BUSY']);
export function labFailure(error){
 const code=LAB_COLLECTION_CODES.includes(error?.code)?error.code:'RIOT_BAD_DATA';
 return {code,status:code==='RIOT_AUTH_FAILED'?401:code==='RIOT_ACCESS_DENIED'?403:error instanceof RiotError?error.status:502,
  retryable:!['RIOT_AUTH_FAILED','RIOT_ACCESS_DENIED','RIOT_BAD_DATA','INVALID_LAB_DATA'].includes(code)};
}
export function matchRegion(matchId,selection){
 const platform=typeof matchId==='string'?matchId.match(/^([A-Z0-9]+)_\d{1,20}$/)?.[1].toLowerCase():null;
 const region=Object.values(RIOT_REGIONS).find(candidate=>candidate.platform===platform);
 if(!region)throw new RiotError('INVALID_MATCH','Mã trận không hợp lệ hoặc server chưa được hỗ trợ.',400);
 if(selection!==undefined&&RIOT_REGIONS[typeof selection==='string'?selection.toLowerCase():'']?.platform!==platform)throw new RiotError('INVALID_REGION','Server không khớp với mã trận.',400);
 return region;
}
async function collectDetails({ids,playerPuuid,region,client,profile,previous=null}){
 let records=[],failures=[],attempted=0;
 for(const matchId of ids){
  attempted++;
  try{
   const raw=await client.get(region.routing,`/lol/match/v5/matches/${encodeURIComponent(matchId)}`,86400);
   if(raw?.metadata?.matchId!==matchId)throw new RiotError('RIOT_BAD_DATA','Riot trả định danh trận không khớp.',502);
   const parsed=createLabSnapshot({rawMatches:[raw],playerPuuid,profile},{source:'riot'});
   // Validate the growing snapshot as each detail arrives; an oversized/invalid match
   // is a per-match failure instead of discarding already collected records.
   exportLabSnapshot({...parsed,records:[...(previous?.records??[]),...records,...parsed.records]});
   records=[...records,...parsed.records];
  }catch(error){
   const failure={matchId,...labFailure(error)};failures=[...failures,failure];
   if(globalCodes.has(failure.code))break;
  }
 }
 const allRecords=[...(previous?.records??[]),...records];
 const collection={requested:ids.length,attempted,succeeded:records.length,failed:failures.length,notAttempted:ids.length-attempted,
  coachingEligible:allRecords.filter(record=>record.coaching.eligible).length,
  failures:[...(previous?.collection?.failures??[]).filter(failure=>!ids.includes(failure.matchId)),...failures],
  notAttemptedIds:[...(previous?.collection?.notAttemptedIds??[]).filter(id=>!ids.includes(id)),...ids.slice(attempted)],
  requestedIds:previous?.collection?.requestedIds??ids,region:Object.keys(RIOT_REGIONS).find(key=>RIOT_REGIONS[key]===region),playerPuuid};
 if(!records.length){
  const error=new RiotError('LAB_NO_SUCCESS','Không tải được chi tiết trận nào. Snapshot trước vẫn được giữ nguyên; xem danh sách lỗi để thử lại.',failures[0]?.status===429?429:502);
  error.collection=collection;throw error;
 }
 const base=previous??createLabSnapshot({rawMatches:[records[0].raw.data],playerPuuid,profile},{source:'riot'});
 return exportLabSnapshot({...base,records:allRecords,collection});
}
export async function collectLab(input,url,env,cache,fetchImpl){
 const query=parseLookup(input);
 if(query.mode!=='sr'||query.start!==0)throw new RiotError('INVALID_INPUT','Data Lab thu thập 10 hoặc 20 trận gần nhất, không lọc Mayhem.',400);
 const client=createRiotClient({key:env.RIOT_API_KEY,origin:new URL(url).origin,cache,fetchImpl}),region=RIOT_REGIONS[query.region];
 const account=await client.get('asia',`/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(query.gameName)}/${encodeURIComponent(query.tagLine)}`,600);
 if(typeof account?.puuid!=='string'||!account.puuid||account.puuid.length>128)throw new RiotError('RIOT_BAD_ACCOUNT','Riot chưa trả định danh tài khoản hợp lệ.',502);
 try{await client.get(region.platform,`/lol/summoner/v4/summoners/by-puuid/${encodeURIComponent(account.puuid)}`,600);}
 catch(error){if(error.code==='RIOT_NOT_FOUND')throw new RiotError('WRONG_SERVER','Riot ID chưa có hồ sơ LoL trên server đã chọn.',404);throw error;}
 const ids=await client.get(region.routing,`/lol/match/v5/matches/by-puuid/${encodeURIComponent(account.puuid)}/ids?start=0&count=${query.count}`,120);
 if(!Array.isArray(ids)||ids.length>query.count||ids.some(id=>typeof id!=='string'||!/^[A-Z0-9]+_\d{1,20}$/.test(id)))throw new RiotError('RIOT_BAD_LIST','Danh sách trận từ Riot không hợp lệ.',502);
 if(!ids.length)throw new RiotError('NO_MATCHES','Riot chưa trả lịch sử trận cho truy vấn này. Data Lab không tạo dữ liệu thay thế.',404);
 ids.forEach(id=>matchRegion(id,query.region));
 return collectDetails({ids:[...new Set(ids)],playerPuuid:account.puuid,region,client,profile:{riotId:`${account.gameName||query.gameName}#${account.tagLine||query.tagLine}`,region:region.label}});
}
export async function retryLab(input,url,env,cache,fetchImpl){
 const previous=createLabSnapshot(input?.snapshot,{source:'imported'}),report=previous.collection;
 if(!report)throw new RiotError('INVALID_INPUT','Snapshot chưa có báo cáo thu thập để thử lại.',400);
 const available=[...new Set([...report.failures.filter(failure=>failure.retryable).map(failure=>failure.matchId),...report.notAttemptedIds])];
 const ids=input.matchIds??available;
 if(!Array.isArray(ids)||!ids.length||ids.length>20||new Set(ids).size!==ids.length||ids.some(id=>!available.includes(id)||previous.records.some(record=>record.matchId===id)))throw new RiotError('INVALID_MATCH','Chỉ thử lại các trận lỗi phù hợp trong snapshot.',400);
 const region=matchRegion(ids[0],report.region);ids.forEach(id=>matchRegion(id,report.region));
 previous.records.forEach(record=>matchRegion(record.matchId,report.region));
 if(previous.records.some(record=>getLabRecordPlayerPuuid(record)!==report.playerPuuid))throw new RiotError('PLAYER_MISMATCH','Định danh người chơi không khớp snapshot.',400);
 if(previous.records.length+ids.length>20)throw new RiotError('INVALID_COUNT','Snapshot tối đa 20 trận.',400);
 const client=createRiotClient({key:env.RIOT_API_KEY,origin:new URL(url).origin,cache,fetchImpl});
 return collectDetails({ids,playerPuuid:report.playerPuuid,region,client,profile:previous.profile,previous});
}
