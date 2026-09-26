import {InputError, ROLES} from './data.js';
import {t} from './i18n.js';
const invalid=()=>{throw new InputError([()=>t('Chi tiết trận đấu không hợp lệ hoặc vượt giới hạn cho phép.')]);};
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
function text(value,max){if(value===undefined||value===null||value==='')return null;if(typeof value!=='string'||value.length>max||/[\u0000-\u001f\u007f]/.test(value))invalid();return value.trim()||null;}
function number(value,max=1000000,min=0){if(value===undefined||value===null)return null;if(typeof value!=='number'||!Number.isSafeInteger(value)||value<min||value>max)invalid();return value;}
function slots(value,size){if(value===undefined||value===null)return Array(size).fill(null);if(!Array.isArray(value)||value.length>size)invalid();return Array.from({length:size},(_,i)=>number(value[i]));}
function runes(value){
 if(value===undefined||value===null)return null;if(!object(value))invalid();
 return {primaryStyle:number(value.primaryStyle),secondaryStyle:number(value.secondaryStyle),primary:slots(value.primary,4),secondary:slots(value.secondary,2),shards:slots(value.shards,3)};
}
function participant(value,mayhem){
 if(!object(value))invalid();
 if(value.teamId!==undefined&&value.teamId!==null&&![100,200].includes(value.teamId))invalid();
 if(value.isPlayer!==undefined&&typeof value.isPlayer!=='boolean')invalid();
 // No verified Riot augment payload is available. Reject unsupported data rather than silently losing it.
 if(value.augments!==undefined&&value.augments!==null)invalid();
 const role=text(value.role,40);
 if(role!==null&&!ROLES.includes(role)&&role!=='Chưa rõ')invalid();
 return {champion:text(value.champion,40),riotId:text(value.riotId,80),role:mayhem?null:role,teamId:value.teamId??null,isPlayer:value.isPlayer??false,
   kills:number(value.kills,mayhem?1000:100),deaths:number(value.deaths,mayhem?1000:100),assists:number(value.assists,mayhem?1000:100),cs:number(value.cs,2000),visionScore:number(value.visionScore,500),damageToChampions:number(value.damageToChampions),goldEarned:number(value.goldEarned),championLevel:number(value.championLevel,100),
   items:slots(value.items,7),summonerSpells:slots(value.summonerSpells,2),runes:runes(value.runes),augments:null};
}
function detail(value,match){
 if(!object(value)||!Array.isArray(value.participants)||value.participants.length>10)invalid();
 const duration=value.durationSeconds;
 if(duration!==undefined&&duration!==null&&(typeof duration!=='number'||!Number.isFinite(duration)||duration<=0||duration>(match.queue==='ARAM Mayhem'?10800:5400)))invalid();
 const participants=value.participants.map(p=>participant(p,match.queue==='ARAM Mayhem'));
 if(participants.filter(p=>p.isPlayer).length>1||[100,200].some(team=>participants.filter(p=>p.teamId===team).length>5))invalid();
 return {durationSeconds:duration??null,gameVersion:text(value.gameVersion,40),participants};
}
export function normalizeHistoryDetails(input,matches){
 if(input===undefined||input===null)return {};
 if(!object(input)||Object.keys(input).length>matches.length)invalid();
 const byId=new Map(matches.map(match=>[match.id,match]));
 return Object.fromEntries(Object.entries(input).map(([id,value])=>{
   if(['__proto__','prototype','constructor'].includes(id)||!byId.has(id))invalid();
   return [id,detail(value,byId.get(id))];
 }));
}
