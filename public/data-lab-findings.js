import {generateReport,RULES} from './coach.js';
import {calculateLabAggregate} from './data-lab-metrics.js';
import {timelineEvidence} from './data-lab-timeline.js';
import {labFindingText as text} from './data-lab-i18n-findings.js';

const normalizedSortKeys=['playedAt','champion','role','queue','result','durationSeconds','visionScore'];
const metricSortKeys=['kda','csPerMinute','goldPerMinute','killParticipation','damageShare','goldShare','visionPerMinute','deathsPer30'];
export const LAB_SORT_KEYS=Object.freeze([...normalizedSortKeys,...metricSortKeys]);
const srQueues=new Set(['Ranked Solo','Ranked Flex','Normal','Standard']);
const roles=new Set(['Top','Jungle','Mid','ADC','Support']);
const topics=Object.freeze({survival:'deathsPer30',farm:'csPerMinute',vision:'visionPerMinute',involvement:'killParticipation'});
const finite=value=>typeof value==='number'&&Number.isFinite(value);

function cleanFilters(filters){
 const string=key=>typeof filters[key]==='string'?filters[key]:'';
 return {role:string('role'),champion:string('champion'),queue:string('queue'),result:string('result'),
  limit:Number(filters.limit)===10?10:20,sortBy:LAB_SORT_KEYS.includes(filters.sortBy)?filters.sortBy:'playedAt',
  direction:filters.direction==='asc'?'asc':'desc'};
}

function sortValue(record,key){
 if(metricSortKeys.includes(key))return finite(record.metrics[key]?.value)?record.metrics[key].value:null;
 const value=record.normalized[key];
 if(key==='playedAt')return value&&finite(Date.parse(value))?Date.parse(value):null;
 return value===undefined||value===null||value===''?null:value;
}

function compareRecords(a,b,filters){
 const av=sortValue(a,filters.sortBy),bv=sortValue(b,filters.sortBy);
 if(av===null&&bv!==null)return 1;
 if(bv===null&&av!==null)return -1;
 const comparison=av===bv?0:typeof av==='number'&&typeof bv==='number'?av-bv:String(av).localeCompare(String(bv),'en');
 return comparison*(filters.direction==='asc'?1:-1)||a.matchId.localeCompare(b.matchId,'en');
}

function eligible(record){
 const n=record.normalized;
 return record.coaching.eligible===true&&srQueues.has(n.queue)&&roles.has(n.role)&&n.isRemake!==true
  &&finite(n.durationMinutes)&&n.durationMinutes>=5&&n.durationMinutes<=90;
}

function ruleReport(record){
 const n=record.normalized,m=record.metrics;
 // Use the same validated denominator as the metric layer (which checks team completeness).
 return generateReport({...n,cs:m.csPerMinute.status==='ok'?n.cs:null,
  visionScore:m.visionPerMinute.status==='ok'?n.visionScore:null,
  teamKills:m.killParticipation.status==='ok'?m.killParticipation.denominator:null});
}

function threshold(topic,role){
 if(topic==='survival')return RULES.deathsReview;
 if(topic==='farm')return RULES.csReview[role];
 if(topic==='vision')return role==='Support'?RULES.supportVisionReview:RULES.visionReview;
 return RULES.kpReview;
}

function evidenceFor(record,topic,scope,knownCount,flaggedCount){
 const metricId=topics[topic],metric=record.metrics[metricId];
 return {id:`rules-v${RULES.version}:${topic}:${record.matchId}:${metricId}`,matchId:record.matchId,metricId,
  value:metric.value,unit:metric.unit,formula:metric.formula,numerator:metric.numerator,denominator:metric.denominator,
  ...(metric.denominatorSource?{denominatorSource:metric.denominatorSource}:{}),
  sample:{selectedCount:scope.selectedCount,eligibleCount:scope.eligibleCount,knownCount,flaggedCount,matchCount:1},
  heuristic:{threshold:threshold(topic,record.normalized.role),comparison:topic==='survival'?'>=':'<',role:record.normalized.role}};
}

function topicFindings(topic,entries,scope){
 const metricId=topics[topic];
 const known=entries.filter(({record})=>(topic!=='farm'||record.normalized.role!=='Support')&&record.metrics[metricId]?.status==='ok'&&finite(record.metrics[metricId].value));
 if(!known.length)return [];
 const flagged=known.filter(({report})=>report.mistakes.some(mistake=>mistake.id===topic));
 const limitations=[text(`${topic}Limit`),text('heuristic'),...(known.some(({record})=>record.completeness.remake.status==='unknown')?[text('unknownRemake')]:[])];
 const make=(type,items,statement,action)=>({id:`rules-v${RULES.version}:${topic}:${type}`,topic,statement,type,
  matchIds:items.map(({record})=>record.matchId),evidence:items.map(({record})=>evidenceFor(record,topic,scope,known.length,flagged.length)),
  limitations:[...limitations],...(action?{action}:{})});
 const observed=make('observed',known,text('observed',{metric:text(topic),known:known.length,eligible:scope.eligibleCount,flagged:flagged.length}));
 if(!flagged.length)return [observed];
 return [observed,make('hypothesis',flagged,text('hypothesis',{metric:text(topic)})),
  make('recommendation',flagged,text(`${topic}Action`),text(`${topic}Action`))];
}

function timelineFindings(record) {
 const evidence=timelineEvidence(record);
 return ['cs_delta','gold_delta','player_death'].flatMap(kind=>{
  const measured=evidence.filter(entry=>entry.kind===kind);
  if(!measured.length)return [];
  return [{id:`timeline-v1:${record.matchId}:${kind}`,topic:'timeline',type:'observed',
   statement:text(`timeline_${kind}`,{count:measured.length,matchId:record.matchId}),matchIds:[record.matchId],
   evidence:measured,limitations:[text('timelineMeasuredLimit'),...(record.timeline?.provenance==='imported'?[text('timelineImported')]:[])]}];
 });
}

function compactTimeline(record) {
 const timeline=record.timeline;
 return {status:timeline?.status??'not_loaded',provenance:timeline?.provenance??null,
  collectedAt:timeline?.collectedAt??null,participantId:timeline?.normalized?.participantId??null,
  checkpoints:timeline?.normalized?.checkpoints??[],sourceRef:`records[${record.matchId}].timeline.raw`};
}

function missingFor(record){
 const completeness=record.completeness;
 return [
  ...completeness.fields.filter(entry=>entry.status!=='available'&&!['isRemake','timeline'].includes(entry.field)).map(entry=>({matchId:record.matchId,...entry,
   category:completeness.basic.missingFields.includes(entry.field)?'basic':'supplementary'})),
  ...Object.entries(record.metrics).filter(([,metric])=>!['ok','deathless'].includes(metric.status)).map(([metricId,metric])=>({matchId:record.matchId,metricId,status:metric.status,category:'metric'})),
  ...(completeness.remake.status==='unknown'?[{matchId:record.matchId,field:'isRemake',status:'unknown',category:'remake',basis:completeness.remake.basis,unknownPolicy:completeness.remake.unknownPolicy,affects:[]}]:[]),
  ...(!record.timeline?.normalized?[{matchId:record.matchId,field:'timeline',status:completeness.timeline.status,category:'timeline',affects:[]}]:[]),
 ];
}

/** Selection is independent of display sorting; all analytical outputs use selectedRecords. */
export function analyzeLabSnapshot(snapshot,filters={}){
 const applied=cleanFilters(filters);
 const filtered=snapshot.records.filter(record=>['role','champion','queue','result'].every(key=>!applied[key]||record.normalized[key]===applied[key]));
 const selectedRecords=[...filtered].sort((a,b)=>compareRecords(a,b,{sortBy:'playedAt',direction:'desc'})).slice(0,applied.limit);
 const records=[...selectedRecords].sort((a,b)=>compareRecords(a,b,applied));
 const eligibleRecords=selectedRecords.filter(eligible);
 const {sortBy,direction,...selectionFilters}=applied;
 const scope={...selectionFilters,inputCount:snapshot.records.length,filteredCount:filtered.length,selectedCount:selectedRecords.length,
  eligibleCount:eligibleRecords.length,excludedCount:selectedRecords.length-eligibleRecords.length,matchIds:selectedRecords.map(record=>record.matchId),
  timelineLoadedCount:selectedRecords.filter(record=>record.timeline?.normalized).length,selectionPolicy:'latest_dated_then_match_id',missingTimestampCount:filtered.filter(record=>sortValue(record,'playedAt')===null).length};
 const entries=eligibleRecords.map(record=>({record,report:ruleReport(record)}));
 return {source:snapshot.source,collectedAt:snapshot.collectedAt,scope,records,selectedRecords,display:{sortBy,direction},
  aggregate:calculateLabAggregate(eligibleRecords),findings:[...Object.keys(topics).flatMap(topic=>topicFindings(topic,entries,scope)),...eligibleRecords.flatMap(timelineFindings)],
  missingData:selectedRecords.flatMap(missingFor),limitations:['heuristic','causal',selectedRecords.some(record=>record.timeline?.normalized)?'timelineMeasuredLimit':'timeline','scope','missing','rules',...(scope.missingTimestampCount?['missingMatchTimes']:[]),...(records.some(record=>record.completeness.remake.status==='unknown')?['unknownRemake']:[]),...(records.some(record=>record.raw?.provenance==='riot_projection')?['projection']:[])].map(key=>text(key)).concat(text('timelineCoverage',{loaded:scope.timelineLoadedCount,selected:scope.selectedCount}))};
}

/** Export from the data layer; no HTML is read and no provider is called. Raw payloads are omitted. */
export function exportCoachingInput(analysis){
 return structuredClone({schemaVersion:2,kind:'rift-review-coaching-input',source:analysis.source,collectedAt:analysis.collectedAt,
  engine:{type:'rules',version:RULES.version,llmUsed:false,heuristic:true},scope:analysis.scope,
  matches:analysis.selectedRecords.map(record=>({matchId:record.matchId,source:record.source,collectedAt:record.collectedAt,
   normalized:record.normalized,metrics:record.metrics,coaching:record.coaching,completeness:record.completeness,timeline:compactTimeline(record)})),
  aggregate:analysis.aggregate,findings:analysis.findings,missingData:analysis.missingData,limitations:analysis.limitations});
}
