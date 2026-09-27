import {hasDuplicateLabParticipants} from './data-lab-metrics.js';

const BASIC=['champion','role','queue','result','durationSeconds','kills','deaths','assists','cs','goldEarned','damageToChampions','visionScore','teamKills'];
const SUPPLEMENTARY=['playedAt','gameVersion','queueId','mapId','teamId','laneMinions','neutralMinions','damageTaken','healing','shielding','wardsPlaced','wardsKilled','controlWardsPlaced','controlWardsBought','participants','items'];
const AFFECTS={
 durationSeconds:['csPerMinute','goldPerMinute','visionPerMinute','deathsPer30'],kills:['kda','killParticipation'],deaths:['kda','deathsPer30'],assists:['kda','killParticipation'],
 cs:['csPerMinute'],laneMinions:['csPerMinute'],neutralMinions:['csPerMinute'],goldEarned:['goldPerMinute','goldShare'],damageToChampions:['damageShare'],visionScore:['visionPerMinute'],
 teamKills:['killParticipation'],teamId:['killParticipation','damageShare','goldShare'],participants:['killParticipation','damageShare','goldShare'],
};
const RIOT_PLAYER={champion:'championName',role:'teamPosition',teamId:'teamId',result:'win',kills:'kills',deaths:'deaths',assists:'assists',laneMinions:'totalMinionsKilled',neutralMinions:'neutralMinionsKilled',goldEarned:'goldEarned',damageToChampions:'totalDamageDealtToChampions',damageTaken:'totalDamageTaken',healing:'totalHeal',shielding:'totalDamageShieldedOnTeammates',visionScore:'visionScore',wardsPlaced:'wardsPlaced',wardsKilled:'wardsKilled',controlWardsPlaced:'detectorWardsPlaced',controlWardsBought:'visionWardsBoughtInGame'};
const RIOT_INFO={playedAt:'gameStartTimestamp',gameVersion:'gameVersion',queueId:'queueId',mapId:'mapId',queue:'queueId',durationSeconds:'gameDuration',participants:'participants'};
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const finite=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0;
const at=(container,key)=>({known:object(container),provided:object(container)&&Object.hasOwn(container,key),value:container?.[key]});
const missing={known:false,provided:false,value:undefined};

function selectedRiotPlayer(n,raw){
 const selected=(n.participants??[]).filter(p=>p.isPlayer===true);
 const rows=raw.data?.info?.participants;
 if(selected.length!==1||!Array.isArray(rows))return null;
 const player=selected[0];
 const found=rows.filter(p=>object(p)&&(typeof player.puuid==='string'&&player.puuid?p.puuid===player.puuid:Number.isInteger(player.participantId)&&player.participantId>0?p.participantId===player.participantId:false));
 return found.length===1?found[0]:null;
}

function combined(container,keys){
 if(!object(container))return missing;
 const values=keys.map(key=>at(container,key));
 // A partially collected derived value is missing; a supplied invalid component is evidence of invalid input.
 if(values.some(entry=>entry.provided&&entry.value!==null&&entry.value!==undefined&&!finite(entry.value)))return {known:true,provided:true,value:'invalid_component'};
 return {known:true,provided:values.every(entry=>entry.provided&&entry.value!==null&&entry.value!==undefined),value:values.map(entry=>entry.value)};
}

function riotTeamKills(n,raw){
 const player=selectedRiotPlayer(n,raw),rows=raw.data?.info?.participants;
 if(!player||!Array.isArray(rows))return missing;
 if(![100,200].includes(player.teamId))return at(player,'teamId');
 const team=rows.filter(p=>object(p)&&p.teamId===player.teamId);
 const invalid=hasDuplicateLabParticipants(team)||team.length>5||team.some(p=>p.kills!==null&&p.kills!==undefined&&(!Number.isSafeInteger(p.kills)||p.kills<0||p.kills>10000000));
 if(invalid)return {known:true,provided:true,value:'invalid_team_kills'};
 if(team.length<5||team.some(p=>p.kills===null||p.kills===undefined))return {known:true,provided:false,value:null};
 return {known:true,provided:true,value:team.reduce((sum,p)=>sum+p.kills,0)};
}

function rosterSource(source){
 // A partial roster describes absent teammates, not invalid stats for the teammates present.
 return Array.isArray(source.value)&&source.value.length<10?{...source,provided:false,value:null}:source;
}

function originalField(n,raw,field){
 if(raw.kind==='riot'){
  if(field==='teamKills')return riotTeamKills(n,raw);
  const info=raw.data?.info;
  if(Object.hasOwn(RIOT_INFO,field)){
   if(field==='playedAt'&&info?.gameStartTimestamp==null)return at(info,'gameCreation');
   return field==='participants'?rosterSource(at(info,'participants')):at(info,RIOT_INFO[field]);
  }
  const player=selectedRiotPlayer(n,raw);
  if(field==='cs')return combined(player,['totalMinionsKilled','neutralMinionsKilled']);
  if(field==='items')return combined(player,Array.from({length:7},(_,i)=>`item${i}`));
  if(Object.hasOwn(RIOT_PLAYER,field))return at(player,RIOT_PLAYER[field]);
  // Match-V5 does not establish an isRemake field here.
  return missing;
 }
 if(raw.kind!=='history'||!object(raw.data))return missing;
 const direct=field==='participants'?rosterSource(at(raw.data,field)):at(raw.data,field);
 if(direct.provided)return direct;
 if(field==='durationSeconds')return at(raw.data,'durationMinutes');
 const players=Array.isArray(raw.data.participants)?raw.data.participants.filter(p=>p?.isPlayer===true):[];
 return players.length===1?at(players[0],field):direct;
}

function available(n,metrics,field){
 if(field==='teamKills')return finite(metrics?.killParticipation?.denominator)||finite(n.teamKills);
 if(field==='participants'){
  const rows=n.participants;
  return Array.isArray(rows)&&rows.length===10&&rows.filter(p=>p.isPlayer===true).length===1
   &&[100,200].every(team=>rows.filter(p=>p.teamId===team).length===5)&&!hasDuplicateLabParticipants(rows);
 }
 if(field==='items')return Array.isArray(n.items)&&n.items.length===7&&n.items.every(finite);
 if(field==='durationSeconds')return finite(n.durationSeconds)&&n.durationSeconds>0;
 const value=n[field];
 return value!==null&&value!==undefined&&value!==''&&(typeof value!=='number'||finite(value));
}

function fieldStatus(n,raw,metrics,field){
 if(field==='timeline'||field==='isRemake'&&raw.kind==='history'&&raw.provenance==='riot_projection')return 'not_collected';
 if(available(n,metrics,field))return 'available';
 const source=originalField(n,raw,field);
 if(source.provided&&source.value!==null&&source.value!==undefined&&source.value!=='')return 'invalid';
 return raw.kind==='riot'&&raw.provenance==='riot_original'&&raw.projection===false&&source.known?'absent':'not_collected';
}

/** Completeness describes independent dimensions, never a claim that the entire Riot API was collected. */
export function calculateLabCompleteness(normalized,raw={},metrics={}){
 const fields=[...BASIC,...SUPPLEMENTARY,'isRemake','timeline'].map(field=>({field,status:fieldStatus(normalized,raw,metrics,field),affects:[...(AFFECTS[field]??[])]}));
 const group=names=>{const missingFields=fields.filter(entry=>names.includes(entry.field)&&entry.status!=='available').map(entry=>entry.field);return {status:missingFields.length?'partial':'complete',missingFields};};
 const projectedRemake=raw.kind==='history'&&raw.provenance==='riot_projection';
 const explicit=!projectedRemake&&typeof normalized.isRemake==='boolean';
 return {basic:group(BASIC),supplementary:group(SUPPLEMENTARY),
  remake:{status:explicit?normalized.isRemake?'yes':'no':'unknown',basis:explicit?'explicit':projectedRemake?'unsupported_projection_inference':'unavailable',unknownPolicy:'allow_if_other_criteria_pass'},
  timeline:{status:'not_loaded'},fields};
}
