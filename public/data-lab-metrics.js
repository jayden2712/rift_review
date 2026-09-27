// End-of-game ratios only. Fractions remain 0..1; formatting belongs to the UI.
const number=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0?value:null;
const add=(a,b)=>number(a)!==null&&number(b)!==null?a+b:null;
function ratio(numerator,denominator,unit,formula,extra={}) {
 const n=number(numerator),d=number(denominator);
 const status=n===null||d===null?'unavailable':d===0?'zero_denominator':Number.isFinite(n/d)?'ok':'unavailable';
 return {value:status==='ok'?n/d:null,unit,status,formula,numerator:n,denominator:d,...extra};
}
// Known identifiers can prove duplicates; equal stats or unknown names cannot.
export function hasDuplicateLabParticipants(participants) {
 return ['puuid','participantId','riotId'].some(key=>{
  const identifiers=participants.map(p=>p[key]).filter(value=>key==='participantId'?Number.isInteger(value)&&value>0:typeof value==='string'&&value.length>0&&(key!=='riotId'||value.includes('#'))).map(value=>key==='riotId'?value.toLowerCase():value);
  return new Set(identifiers).size!==identifiers.length;
 });
}
function teamTotal(match,field) {
 const participants=Array.isArray(match.participants)?match.participants:[];
 const players=participants.filter(p=>p.isPlayer===true);
 if(hasDuplicateLabParticipants(participants)||![100,200].includes(match.teamId)||players.length!==1||players[0].teamId!==match.teamId)return null;
 const team=participants.filter(p=>p.teamId===match.teamId);
 if(team.length!==5||team.some(p=>number(p[field])===null)||players[0][field]!==match[field])return null;
 return team.reduce((sum,p)=>sum+p[field],0);
}
function share(numerator,denominator,formula,denominatorSource) {
 const metric=ratio(numerator,denominator,'fraction',formula,{denominatorSource});
 return metric.value!==null&&metric.value>1?{...metric,value:null,status:'inconsistent_data'}:metric;
}
export function calculateLabMetrics(match) {
 // Seconds are canonical when supplied; no fallback from explicitly invalid zero.
 const seconds=match.durationSeconds===undefined?number(match.durationMinutes)===null?null:match.durationMinutes*60:number(match.durationSeconds);
 const minutes=seconds===null?null:seconds/60;
 const participants=Array.isArray(match.participants)?match.participants:[];
 const teamKills=participants.length?teamTotal(match,'kills'):number(match.teamKills);
 const kda=ratio(add(match.kills,match.assists),match.deaths,'ratio','(kills + assists) / deaths');
 return {
  csPerMinute:ratio(match.cs,minutes,'CS/min','CS / (durationSeconds / 60)'),
  goldPerMinute:ratio(match.goldEarned,minutes,'gold/min','goldEarned / (durationSeconds / 60)'),
  killParticipation:share(add(match.kills,match.assists),teamKills,'(kills + assists) / teamKills',participants.length?'complete_participant_team':'reported_team_total'),
  damageShare:share(match.damageToChampions,teamTotal(match,'damageToChampions'),'damageToChampions / teamDamageToChampions','complete_participant_team'),
  goldShare:share(match.goldEarned,teamTotal(match,'goldEarned'),'goldEarned / teamGoldEarned','complete_participant_team'),
  kda:kda.status==='zero_denominator'&&kda.numerator>0?{...kda,status:'deathless'}:kda,
  visionPerMinute:ratio(match.visionScore,minutes,'vision/min','visionScore / (durationSeconds / 60)'),
  deathsPer30:ratio(number(match.deaths)===null?null:match.deaths*30,minutes,'deaths/30min','(deaths * 30) / (durationSeconds / 60)'),
 };
}
// Cohort scope: only coaching-eligible standard SR records. Each metric then has
// its own valid sample. Pooled=sum(numerator)/sum(denominator); mean=mean(ratios).
export function calculateLabAggregate(records) {
 const names=Object.keys(calculateLabMetrics({}));
 return Object.fromEntries(names.map(name=>{
  const template=calculateLabMetrics({})[name];
  const metrics=records.filter(record=>record.coaching?.eligible===true).map(record=>calculateLabMetrics(record.normalized)[name]).filter(metric=>metric.status==='ok');
  const numerator=metrics.reduce((sum,metric)=>sum+metric.numerator,0);
  const denominator=metrics.reduce((sum,metric)=>sum+metric.denominator,0);
  return [name,{pooledValue:metrics.length&&denominator>0?numerator/denominator:null,meanValue:metrics.length?metrics.reduce((sum,metric)=>sum+metric.value,0)/metrics.length:null,sampleSize:metrics.length,numerator,denominator,unit:template.unit,formula:template.formula,scope:'coaching_eligible_standard_sr'}];
 }));
}
