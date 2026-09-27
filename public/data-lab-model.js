import {calculateLabMetrics} from './data-lab-metrics.js';
import {LAB_MAX_BYTES,DataLabInputError,assertLabSize,cloneLabRawBody} from './data-lab-raw.js';
import {calculateLabCompleteness} from './data-lab-completeness.js';
export {LAB_MAX_BYTES,DataLabInputError};
export const LAB_SCHEMA_VERSION=2;
export const LAB_MAX_RECORDS=20;
const KIND='rift-review-data-lab';
const ROLES=['Top','Jungle','Mid','ADC','Support'];
const QUEUES={420:'Ranked Solo',440:'Ranked Flex',400:'Normal',430:'Normal',490:'Normal',450:'ARAM',2400:'ARAM Mayhem'};
const ROLE_MAP={TOP:'Top',JUNGLE:'Jungle',MIDDLE:'Mid',BOTTOM:'ADC',UTILITY:'Support'};
const STATS=['kills','deaths','assists','laneMinions','neutralMinions','cs','goldEarned','damageToChampions','damageTaken','healing','shielding','visionScore','wardsPlaced','wardsKilled','controlWardsPlaced','controlWardsBought'];
const RIOT_FIELDS={kills:'kills',deaths:'deaths',assists:'assists',laneMinions:'totalMinionsKilled',neutralMinions:'neutralMinionsKilled',goldEarned:'goldEarned',damageToChampions:'totalDamageDealtToChampions',damageTaken:'totalDamageTaken',healing:'totalHeal',shielding:'totalDamageShieldedOnTeammates',visionScore:'visionScore',wardsPlaced:'wardsPlaced',wardsKilled:'wardsKilled',controlWardsPlaced:'detectorWardsPlaced',controlWardsBought:'visionWardsBoughtInGame'};
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
function fail(message){throw new DataLabInputError(message);}
function text(value,max=200) {
 if(value===undefined||value===null||value==='')return null;
 if(typeof value!=='string'||value.length>max||/[\u0000-\u001f\u007f]/.test(value)||/RGAPI-/i.test(value))fail('Invalid text or credential-like content in Data Lab input.');
 return value.trim()||null;
}
function num(value,max=10000000){return typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=max?value:null;}
function integer(value,max=10000000){const n=num(value,max);return Number.isSafeInteger(n)?n:null;}
function date(value){if(value===undefined||value===null)return null;const d=typeof value==='number'?new Date(value):typeof value==='string'?new Date(value):null;return d&&Number.isFinite(d.valueOf())?d.toISOString():null;}
function bool(value){return typeof value==='boolean'?value:null;}
function role(value){return ROLES.includes(value)?value:null;}
function slots(value){return Array.from({length:7},(_,i)=>integer(Array.isArray(value)?value[i]:null));}
function stats(value){return Object.fromEntries(STATS.map(key=>[key,integer(value[key])]));}
function participant(value) {
 if(!object(value))fail('Invalid participant.');
 return {...stats(value),puuid:text(value.puuid,200),participantId:integer(value.participantId,10)||null,champion:text(value.champion,50),riotId:text(value.riotId,100),role:role(value.role),teamId:[100,200].includes(value.teamId)?value.teamId:null,isPlayer:value.isPlayer===true,items:slots(value.items)};
}
function participants(value) {
 if(value===null||value===undefined)return [];
 if(!Array.isArray(value)||value.length>10)fail('A Data Lab match supports at most 10 participants.');
 return value.map(participant);
}
function riotParticipant(value,playerPuuid) {
 const fields=Object.fromEntries(Object.entries(RIOT_FIELDS).map(([key,original])=>[key,integer(value[original])]));
 return {...fields,puuid:text(value.puuid,200),participantId:integer(value.participantId,10)||null,cs:fields.laneMinions!==null&&fields.neutralMinions!==null?fields.laneMinions+fields.neutralMinions:null,champion:text(value.championName,50),riotId:value.riotIdGameName?text(`${value.riotIdGameName}${value.riotIdTagline?'#'+value.riotIdTagline:''}`,100):null,role:ROLE_MAP[value.teamPosition]??null,teamId:[100,200].includes(value.teamId)?value.teamId:null,isPlayer:value.puuid===playerPuuid,items:slots(Array.from({length:7},(_,i)=>value[`item${i}`]))};
}
function normalized(input,detail={}) {
 if(!object(input))fail('Invalid normalized match.');
 const rows=participants(detail.participants??input.participants);
 const player=rows.filter(p=>p.isPlayer===true);
 const seconds=Object.hasOwn(input,'durationSeconds')?num(input.durationSeconds,86400):Object.hasOwn(detail,'durationSeconds')&&detail.durationSeconds!==null?num(detail.durationSeconds,86400):num(input.durationMinutes,1440)!==null?input.durationMinutes*60:null;
 const source={...(player.length===1?player[0]:{}),...input};
 const values=stats(source);
 const cs=values.cs??(values.laneMinions!==null&&values.neutralMinions!==null?values.laneMinions+values.neutralMinions:null);
 return {id:text(input.id??input.matchId),playedAt:date(input.playedAt),gameVersion:text(input.gameVersion??detail.gameVersion,50),queueId:integer(input.queueId,10000),mapId:integer(input.mapId,1000),queue:text(input.queue,50)??'Other',champion:text(source.champion,50),riotId:text(source.riotId,100),role:role(source.role),teamId:[100,200].includes(source.teamId)?source.teamId:null,result:['Victory','Defeat'].includes(input.result)?input.result:null,durationSeconds:seconds,durationMinutes:seconds===null?null:seconds/60,isRemake:bool(input.isRemake),gameEndedInEarlySurrender:bool(input.gameEndedInEarlySurrender),...values,cs,teamKills:integer(input.teamKills),items:slots(source.items),participants:rows};
}
// Preserve the established History v1/v3 input conveniences at that boundary
// only. Riot DTOs and already-normalized snapshots still require typed values.
function adaptHistoryMatch(match) {
 if(!object(match))return match;
 const numericKeys=['durationMinutes','kills','deaths','assists','cs','visionScore','teamKills','goldEarned','damageToChampions'];
 const numbers=Object.fromEntries(numericKeys.filter(key=>Object.hasOwn(match,key)).map(key=>{
  const value=match[key];
  return [key,typeof value==='string'?(value.trim()===''?null:Number(value)):value];
 }));
 const canonical=(value,choices)=>typeof value==='string'?choices.find(choice=>choice.toLowerCase()===value.toLowerCase())??null:null;
 return {...match,...numbers,queue:match.queue??(match.queueId==null?'Standard':QUEUES[match.queueId]??'Other'),...(Object.hasOwn(match,'role')?{role:canonical(match.role,ROLES)}:{}),...(Object.hasOwn(match,'result')?{result:canonical(match.result,['Victory','Defeat'])}:{})};
}
function fromRiot(raw,playerPuuid) {
 if(!object(raw)||!object(raw.info)||!Array.isArray(raw.info.participants)||!playerPuuid)fail('Riot match requires participants and a selected player.');
 if(raw.info.participants.length>10||raw.info.participants.some(p=>!object(p)))fail('Invalid Riot participants.');
 const selected=raw.info.participants.filter(p=>p.puuid===playerPuuid);
 if(selected.length!==1)fail('Selected player is missing or ambiguous in Riot match.');
 const info=raw.info,rows=info.participants.map(p=>riotParticipant(p,playerPuuid)),player=rows.find(p=>p.isPlayer);
 const queueId=integer(info.queueId,10000);
 return normalized({...player,id:raw.metadata?.matchId,playedAt:date(info.gameStartTimestamp??info.gameCreation),gameVersion:info.gameVersion,queueId,mapId:info.mapId,queue:QUEUES[queueId]??'Other',result:selected[0].win===true?'Victory':selected[0].win===false?'Defeat':null,durationSeconds:info.gameDuration,isRemake:null,gameEndedInEarlySurrender:bool(selected[0].gameEndedInEarlySurrender),participants:rows});
}
// Projection retains only known supplied source fields. It is deliberately not
// a complete raw Riot payload; credentials, request headers and notes are never copied.
function project(value,keys,preserveStrings=false) {return Object.fromEntries(keys.filter(key=>Object.hasOwn(value,key)).map(key=>{
 const original=value[key];
 const safeString=typeof original==='string'?text(original,200):null;
 return [key,typeof original==='string'?(preserveStrings?original:safeString):typeof original==='number'?(Number.isFinite(original)?original:null):typeof original==='boolean'?original:null];
 }));}
function rawHistory(input,detail) {
 const projected=project(input,['id','matchId','playedAt','gameVersion','queueId','mapId','queue','champion','riotId','role','teamId','result','durationSeconds','durationMinutes','isRemake','gameEndedInEarlySurrender',...STATS,'teamKills'],true);
 const items=Object.hasOwn(input,'items')?{items:slots(input.items)}:{};
 const rows=detail?.participants??input.participants;
 return {...projected,...items,...(Array.isArray(rows)?{participants:participants(rows)}:{})};
}
function readRaw(raw,source,schemaVersion=LAB_SCHEMA_VERSION) {
 if(!object(raw)||raw.kind==='unavailable')return {kind:'unavailable',data:null,projection:true,provenance:'unavailable'};
 if(!['riot','history'].includes(raw.kind)||!object(raw.data))fail('Invalid raw source kind.');
 const original=schemaVersion!==1&&raw.kind==='riot'&&raw.projection===false&&raw.provenance==='riot_original';
 const provenance=source==='demo'?'demo':original?'riot_original':raw.kind==='riot'||raw.provenance==='riot_projection'?'riot_projection':'manual';
 const data=cloneLabRawBody(raw.data);
 return {kind:raw.kind,data,projection:!original,provenance};
}
export function getLabRecordPlayerPuuid(entry) {
 const rows=entry?.normalized?.participants;
 if(!Array.isArray(rows))fail('Snapshot lacks a reliable selected player identity.');
 const selected=rows.filter(p=>p.isPlayer===true);
 if(selected.length!==1)fail('Snapshot lacks a unique selected player identity.');
 const player=selected[0],known=text(player.puuid,200);
 if(known){if(rows.filter(p=>p.puuid===known).length!==1)fail('Snapshot player identity is ambiguous.');return known;}
 const rawRows=entry.raw?.kind==='riot'?entry.raw.data?.info?.participants:null;
 if(!Array.isArray(rawRows)||typeof player.riotId!=='string'||!player.riotId.includes('#'))fail('Snapshot lacks a reliable selected player identity.');
 const matches=rawRows.filter(p=>object(p)&&p.teamId===player.teamId&&p.championName===player.champion&&typeof p.riotIdGameName==='string'&&typeof p.riotIdTagline==='string'&&`${p.riotIdGameName}#${p.riotIdTagline}`.toLowerCase()===player.riotId.toLowerCase());
 const puuid=matches.length===1?text(matches[0].puuid,200):null;
 if(!puuid||rawRows.filter(p=>p.puuid===puuid).length!==1)fail('Snapshot player identity is missing or ambiguous.');
 return puuid;
}
function importedRecord(entry,source,collectedAt,index,schemaVersion) {
 if(!object(entry)||!object(entry.normalized))fail('Invalid Data Lab record.');
 const raw=readRaw(entry.raw,source,schemaVersion);
 const base=normalized(entry.normalized);
 if(raw.provenance!=='riot_original')return record(base,raw,source,date(entry.collectedAt)??collectedAt,index);
 if(raw.data.metadata?.matchId!==entry.matchId||entry.matchId!==base.id)fail('Raw match identity does not match the snapshot record.');
 const playerPuuid=getLabRecordPlayerPuuid({...entry,normalized:base,raw});
 return record(fromRiot(raw.data,playerPuuid),raw,source,date(entry.collectedAt)??collectedAt,index);
}
function eligibility(match) {
 const reasons=[...(!['Ranked Solo','Ranked Flex','Normal','Standard'].includes(match.queue)||match.queueId!==null&&![420,440,400,430,490].includes(match.queueId)||match.mapId!==null&&match.mapId!==11?['unsupported_queue']:[]),...(match.isRemake===true?['remake']:[]),...(match.durationMinutes===null||match.durationMinutes<5||match.durationMinutes>90?['invalid_duration']:[]),...(!role(match.role)?['unknown_role']:[]),...(['champion','result','kills','deaths','assists'].some(key=>match[key]===null)?['missing_coaching_fields']:[])];
 return {eligible:reasons.length===0,reasons,unknownRemakePolicy:'allow_if_other_criteria_pass',limitations:match.isRemake===null?['remake_status_unknown']:[]};
}
function record(match,raw,source,collectedAt,index) {
 // The existing Riot history mapper supplies a default false after a duration
 // filter; that reduced field is not authoritative remake evidence.
 const mappedRiotHistory=raw.kind==='history'&&raw.provenance==='riot_projection';
 const normalizedMatch={...match,id:match.id??`import-${index+1}`,isRemake:mappedRiotHistory?null:match.isRemake};
 const metrics=calculateLabMetrics(normalizedMatch);
 return {matchId:normalizedMatch.id,source,collectedAt,raw,normalized:normalizedMatch,metrics,completeness:calculateLabCompleteness(normalizedMatch,raw,metrics),coaching:eligibility(normalizedMatch)};
}
export function createLabSnapshot(input,options={}) {
 assertLabSize(input);
 if(typeof input==='string'){try{input=JSON.parse(input);}catch{fail('Invalid Data Lab JSON.');}}
 if(Array.isArray(input))input={matches:input};
 if(!object(input))fail('Data Lab requires an object.');
 const candidates=input.records??input.rawMatches??input.matches;
 if(Array.isArray(candidates)&&(candidates.length<1||candidates.length>LAB_MAX_RECORDS))fail('Data Lab requires 1 to 20 matches. Select a smaller group before importing.');
 const source=options.source==='riot'?'riot':options.source==='demo'||input.source==='demo'?'demo':'imported';
 const collectedAt=date(options.collectedAt??input.collectedAt)??new Date().toISOString();
 const profileInput=options.profile??input.profile??{};
 if(!object(profileInput))fail('Invalid profile.');
 const profile={riotId:text(profileInput.riotId,100),region:text(profileInput.region,30)};
 let records;
 if(input.kind===KIND){
  if(![1,LAB_SCHEMA_VERSION].includes(input.schemaVersion))fail('Unsupported Data Lab schema version.');
  if(!Array.isArray(input.records))fail('Missing Data Lab records.');
  records=input.records.map((entry,index)=>importedRecord(entry,options.preserveRecordSources&&['riot','imported','demo'].includes(entry?.source)?entry.source:source,collectedAt,index,input.schemaVersion));
 }else if(Array.isArray(input.rawMatches)){
  const puuid=text(options.playerPuuid??input.playerPuuid,200);
  records=input.rawMatches.map((raw,index)=>{const data=cloneLabRawBody(raw);return record(fromRiot(data,puuid),{kind:'riot',data,projection:false,provenance:source==='demo'?'demo':'riot_original'},source,collectedAt,index);});
 }else{
  if(input.schemaVersion!==undefined&&![1,2,3].includes(input.schemaVersion))fail('Unsupported history schema version.');
  const matches=input.matches??(input.champion?[input]:null);
  if(!Array.isArray(matches))fail('Missing history matches.');
  records=matches.map((match,index)=>{const detail=object(input.details)?input.details[match?.id]:undefined;const adapted=adaptHistoryMatch(match);return record(normalized(adapted,detail??{}),{kind:'history',data:rawHistory(match,detail),projection:true,provenance:source==='demo'?'demo':options.historyProvenance==='riot_projection'?'riot_projection':'manual'},source,collectedAt,index);});
 }
 if(records.length<1||records.length>LAB_MAX_RECORDS)fail('Data Lab requires 1 to 20 matches. Select a smaller group before importing.');
 if(new Set(records.map(r=>r.matchId)).size!==records.length)fail('Duplicate match IDs in Data Lab snapshot.');
 const snapshot={kind:KIND,schemaVersion:LAB_SCHEMA_VERSION,source,collectedAt,profile,records};
 assertLabSize(snapshot);
 return snapshot;
}
export function exportLabSnapshot(snapshot){return createLabSnapshot(snapshot,{source:snapshot.source,collectedAt:snapshot.collectedAt,preserveRecordSources:true});}
export function replaceLabRecordRaw(snapshot,matchId,raw) {
 const current=exportLabSnapshot(snapshot);
 const index=current.records.findIndex(entry=>entry.matchId===matchId);
 if(index<0)fail('Match not found in this snapshot.');
 const previous=current.records[index];
 if(!previous.raw.projection)fail('This record already contains its original match response.');
 const data=cloneLabRawBody(raw);
 if(data?.metadata?.matchId!==matchId)fail('Riot response match ID does not match the requested record.');
 const playerPuuid=getLabRecordPlayerPuuid(previous);
 const replacement=record(fromRiot(data,playerPuuid),{kind:'riot',data,projection:false,provenance:'riot_original'},'riot',new Date().toISOString(),index);
 const updated={...current,records:current.records.map((entry,i)=>i===index?replacement:entry)};
 assertLabSize(updated);
 return updated;
}
export function createDemoLabSnapshot(count=10) {
 if(!Number.isInteger(count)||count<1||count>LAB_MAX_RECORDS)fail('Demo count must be between 1 and 20.');
 const matches=Array.from({length:count},(_,i)=>{
 const role=['Mid','ADC','Support','Jungle','Top'][i%5],durationMinutes=20+i%10;
 const player={champion:['Ahri','Jinx','Leona','Vi','Garen'][i%5],riotId:'Data Lab#DEMO',role,teamId:100,isPlayer:true,kills:3+i%7,deaths:2+i%6,assists:5+i%8,laneMinions:role==='Support'?25:100+i*6,neutralMinions:role==='Jungle'?70:5,damageToChampions:14000+i*800,damageTaken:11000+i*400,healing:250+i*50,shielding:100+i*20,goldEarned:10000+i*300,visionScore:role==='Support'?45:15+i,wardsPlaced:7,wardsKilled:2,controlWardsPlaced:1,controlWardsBought:2,items:[1001,1056,3020,3089,0,0,3340]};
 const rows=Array.from({length:10},(_,j)=>j===0?player:{...player,riotId:`Demo ${j}`,isPlayer:false,teamId:j<5?100:200,role:['Mid','ADC','Support','Jungle','Top'][j%5],kills:4+j%5,damageToChampions:12000+j*1000,goldEarned:9000+j*500});
 return {...player,id:`LAB_DEMO_${i+1}`,playedAt:new Date(Date.UTC(2026,8,20,12)-i*3600000).toISOString(),gameVersion:'16.18.1',queueId:420,mapId:11,queue:'Ranked Solo',result:i%3===0?'Defeat':'Victory',durationMinutes,isRemake:false,cs:player.laneMinions+player.neutralMinions,participants:rows};
 });
 return createLabSnapshot({profile:{riotId:'Data Lab#DEMO',region:'DEMO'},matches},{source:'demo',collectedAt:'2026-09-27T00:00:00.000Z'});
}
