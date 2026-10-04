import {DataLabInputError,cloneLabRawBody} from './data-lab-raw.js';
import {LAB_COLLECTION_CODES} from './data-lab-collection.js';
export const LAB_TIMELINE_MAX_BYTES=2*1024*1024;
export const LAB_TIMELINE_TOLERANCE_MS=60000;
const STATES=['not_loaded','loading','loaded','unavailable','error'];
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const number=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0?v:null;
const id=v=>Number.isInteger(v)&&v>=1&&v<=10;
const fail=message=>{throw new DataLabInputError(message);};
const date=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))?new Date(value).toISOString():null;
const LIMITS=['sampled_frames_no_interpolation','observations_do_not_establish_causes'];
export function emptyLabTimeline(){return {status:'not_loaded',raw:null,normalized:null,collectedAt:null,lastAttemptAt:null,lastError:null,provenance:'unavailable'};}
function identity(raw,record){
 if(record?.normalized?.mapId!==11)fail('Timeline is supported only for confirmed Summoner’s Rift matches.');
 if(!object(raw)||raw.metadata?.matchId!==record.matchId||!object(raw.info)||!Array.isArray(raw.info.frames)||!Array.isArray(raw.info.participants))fail('Timeline match identity or structure is invalid.');
 const rows=raw.info.participants,selected=(record.normalized.participants??[]).filter(p=>p.isPlayer);
 if(rows.length<1||rows.length>10||selected.length!==1)fail('Timeline requires a unique selected participant.');
 if(rows.some(p=>!object(p)||!id(p.participantId)||typeof p.puuid!=='string'||!p.puuid||p.puuid.length>200)||new Set(rows.map(p=>p.participantId)).size!==rows.length||new Set(rows.map(p=>p.puuid)).size!==rows.length)fail('Timeline participant mapping is invalid or ambiguous.');
 const roster=record.normalized.participants??[];
 if(new Set(roster.map(p=>p.puuid).filter(Boolean)).size!==roster.filter(p=>p.puuid).length||new Set(roster.map(p=>p.participantId).filter(Boolean)).size!==roster.filter(p=>p.participantId).length)fail('Match participant mapping is ambiguous.');
 for(const p of roster){const found=rows.find(q=>q.puuid===p.puuid);if(!found||p.participantId!==null&&p.participantId!==undefined&&found.participantId!==p.participantId)fail('Timeline participant mapping does not match the match roster.');}
 if(rows.length!==roster.length)fail('Timeline participant roster does not match the match.');
 const player=rows.find(p=>p.puuid===selected[0].puuid);
 if(!player)fail('Timeline selected player cannot be mapped by PUUID.');
 if(!Array.isArray(raw.metadata.participants)||new Set(raw.metadata.participants).size!==rows.length||raw.metadata.participants.length!==rows.length||rows.some(p=>!raw.metadata.participants.includes(p.puuid)))fail('Timeline metadata participant mapping is inconsistent.');
 return player.participantId;
}
function frameRows(raw,participantId){
 const known=new Map(raw.info.participants.map(p=>[String(p.participantId),p.participantId]));
 return raw.info.frames.map((frame,index)=>{
  if(!object(frame)||number(frame.timestamp)===null||!object(frame.participantFrames)||!Array.isArray(frame.events))fail('Timeline frame structure is invalid.');
  for(const [key,value] of Object.entries(frame.participantFrames))if(!known.has(key)||!object(value)||value.participantId!==known.get(key))fail('Timeline frame participant mapping is inconsistent.');
  const p=frame.participantFrames[String(participantId)]??{},lane=number(p.minionsKilled),jungle=number(p.jungleMinionsKilled);
  return {timestamp:frame.timestamp,participantFrameAvailable:Object.hasOwn(frame.participantFrames,String(participantId)),sourceFrameIndex:index,sourcePath:`info.frames[${index}].participantFrames["${participantId}"]`,cs:lane!==null&&jungle!==null?lane+jungle:null,totalGold:number(p.totalGold),currentGold:number(p.currentGold),xp:number(p.xp),level:number(p.level)};
 }).sort((a,b)=>a.timestamp-b.timestamp||a.sourceFrameIndex-b.sourceFrameIndex);
}
function checkpoint(frames,targetTimestamp,duration){
 const missing=reason=>({targetTimestamp,actualTimestamp:null,offsetMs:null,reason,cs:null,totalGold:null,currentGold:null,xp:null,level:null,sourcePath:null});
 if(duration===null)return missing('unknown_duration');
 if(duration*1000<targetTimestamp)return missing('ended_before_target');
 const frame=frames.filter(f=>f.timestamp<=targetTimestamp&&targetTimestamp-f.timestamp<=LAB_TIMELINE_TOLERANCE_MS).at(-1);
 if(!frame)return missing('no_frame_within_tolerance');
 const {timestamp,sourceFrameIndex,...values}=frame;
 return {...values,targetTimestamp,actualTimestamp:timestamp,offsetMs:timestamp-targetTimestamp,reason:frame.participantFrameAvailable?null:'participant_frame_missing'};
}
const EVENT_TYPES=new Set(['CHAMPION_KILL','ITEM_PURCHASED','ITEM_SOLD','ITEM_UNDO','ITEM_DESTROYED','ELITE_MONSTER_KILL','BUILDING_KILL','TURRET_PLATE_DESTROYED']);
function events(raw,participantId){
 return raw.info.frames.flatMap((frame,frameIndex)=>frame.events.flatMap((event,eventIndex)=>{
  if(!object(event)||!EVENT_TYPES.has(event.type)||number(event.timestamp)===null)return [];
  const assist=Array.isArray(event.assistingParticipantIds)?event.assistingParticipantIds.filter(id):[];
  const role=event.type==='CHAMPION_KILL'?event.victimId===participantId?'death':event.killerId===participantId?'kill':assist.includes(participantId)?'assist':null:event.type.startsWith('ITEM_')&&event.participantId===participantId?'item':null;
  const numeric=Object.fromEntries(['killerId','victimId','participantId','itemId','beforeId','afterId','goldGain','teamId','killerTeamId'].filter(k=>number(event[k])!==null).map(k=>[k,event[k]]));
  const strings=Object.fromEntries(['monsterType','monsterSubType','buildingType','towerType','laneType'].filter(k=>typeof event[k]==='string'&&event[k].length<=100).map(k=>[k,event[k]]));
  return [{id:`${raw.metadata.matchId}:timeline:event:${frameIndex}:${eventIndex}`,timestamp:event.timestamp,type:event.type,playerRelated:role!==null||event.killerId===participantId||assist.includes(participantId),playerRole:role,sourcePath:`info.frames[${frameIndex}].events[${eventIndex}]`,...numeric,...strings,assistingParticipantIds:assist}];
 })).sort((a,b)=>a.timestamp-b.timestamp);
}
export function normalizeLabTimeline(raw,record){
 const participantId=identity(raw,record),frames=frameRows(raw,participantId);
 return {matchId:record.matchId,participantId,frames,checkpoints:[600000,900000,1200000].map(t=>checkpoint(frames,t,number(record.normalized.durationSeconds))),events:events(raw,participantId),limitations:[...LIMITS]};
}
function safeError(value){
 if(value==null)return null;
 if(!object(value))fail('Invalid timeline error.');
 const code=[...LAB_COLLECTION_CODES,'RIOT_NOT_CONFIGURED','TIMELINE_ERROR'].includes(value.code)?value.code:'TIMELINE_ERROR';
 // Never persist arbitrary network errors: they can contain URLs or credentials.
 return {code,status:Number.isInteger(value.status)&&value.status>=400&&value.status<=599?value.status:null,message:'Timeline request failed.',retryable:value.retryable===true};
}
export function readLabTimeline(value,record,{trusted=false}={}){
 if(value==null)return emptyLabTimeline();
 if(!object(value)||!STATES.includes(value.status))fail('Invalid timeline collection state.');
 let raw=null,normalized=null;
 if(value.raw!==null&&value.raw!==undefined){
  if(new TextEncoder().encode(JSON.stringify(value.raw)).byteLength>LAB_TIMELINE_MAX_BYTES)fail('Raw timeline exceeds the 2 MiB per-match limit.');
  raw=cloneLabRawBody(value.raw);normalized=normalizeLabTimeline(raw,record);
 }
 if(value.status==='loaded'&&!raw)fail('A loaded timeline requires its full raw body.');
 return {status:value.status,raw,normalized,collectedAt:date(value.collectedAt),lastAttemptAt:date(value.lastAttemptAt),lastError:safeError(value.lastError),provenance:raw?trusted&&value.provenance==='riot_original'?'riot_original':'imported':'unavailable'};
}
export function timelineEvidence(record){
 const n=record.timeline?.normalized;
 if(!n)return [];
 const limits=[...LIMITS,...(record.timeline.provenance==='imported'?['imported_unverified']:[])];
 const base={matchId:record.matchId,participantId:n.participantId,limitations:limits};
 const deltas=n.frames.slice(1).flatMap((to,i)=>{
  const from=n.frames[i];if(to.timestamp<=from.timestamp)return [];
  return ['cs','totalGold'].flatMap(field=>{
   if(from[field]===null||to[field]===null)return [];
   const kind=field==='cs'?'cs_delta':'gold_delta',fields=field==='cs'?['minionsKilled','jungleMinionsKilled']:['totalGold'];
   return [{...base,id:`${record.matchId}:timeline:${kind}:${from.sourceFrameIndex}:${to.sourceFrameIndex}`,kind,fromTimestamp:from.timestamp,toTimestamp:to.timestamp,timestamp:null,value:to[field]-from[field],sourceFields:[...fields.map(f=>`${from.sourcePath}.${f}`),...fields.map(f=>`${to.sourcePath}.${f}`)],formula:field==='cs'?'(end.minionsKilled + end.jungleMinionsKilled) - (start.minionsKilled + start.jungleMinionsKilled)':'end.totalGold - start.totalGold'}];
  });
 });
 const deaths=n.events.filter(e=>e.playerRole==='death').map(e=>({...base,id:`${e.id}:death`,kind:'player_death',timestamp:e.timestamp,fromTimestamp:null,toTimestamp:null,value:1,sourceFields:[`${e.sourcePath}.timestamp`,`${e.sourcePath}.victimId`],formula:'CHAMPION_KILL.victimId === participantId'}));
 return [...deltas,...deaths];
}
