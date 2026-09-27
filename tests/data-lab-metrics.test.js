import test from 'node:test';
import assert from 'node:assert/strict';
import {calculateLabMetrics,calculateLabAggregate} from '../public/data-lab-metrics.js';
const match=(extra={})=>({durationSeconds:1200,durationMinutes:20,cs:120,goldEarned:10000,kills:4,assists:6,deaths:2,visionScore:20,damageToChampions:20000,teamId:100,teamKills:20,participants:[],...extra});
const team=()=>Array.from({length:5},(_,i)=>({teamId:100,isPlayer:i===0,kills:4,damageToChampions:20000,goldEarned:10000}));
test('metrics expose exact formulas, units, ratios and reported team total provenance',()=>{
 const m=calculateLabMetrics(match());assert.equal(m.csPerMinute.value,6);assert.equal(m.goldPerMinute.value,500);assert.equal(m.killParticipation.value,.5);assert.equal(m.killParticipation.denominatorSource,'reported_team_total');assert.equal(m.kda.value,5);assert.equal(m.visionPerMinute.value,1);assert.equal(m.damageShare.value,null);assert.equal(m.killParticipation.unit,'fraction');assert.ok(m.csPerMinute.formula);
});
test('zero and missing data remain different; duration and deaths zero never divide',()=>{
 assert.equal(calculateLabMetrics(match({cs:0})).csPerMinute.value,0);
 assert.equal(calculateLabMetrics(match({cs:null})).csPerMinute.value,null);
 assert.equal(calculateLabMetrics(match({durationSeconds:0,durationMinutes:0})).csPerMinute.status,'zero_denominator');
 assert.equal(calculateLabMetrics(match({durationSeconds:null,durationMinutes:null})).csPerMinute.status,'unavailable');
 assert.equal(calculateLabMetrics(match({deaths:0})).kda.status,'deathless');
 assert.equal(calculateLabMetrics(match({kills:0,assists:0,deaths:0})).kda.status,'zero_denominator');
 assert.equal(calculateLabMetrics(match({teamKills:0})).killParticipation.status,'zero_denominator');
 assert.ok(!JSON.stringify(calculateLabMetrics(match({cs:Infinity}))).includes('Infinity'));
});
test('complete five-player team required; partial or inconsistent player/team cannot produce shares',()=>{
 const full=match({participants:team()});assert.equal(calculateLabMetrics(full).damageShare.value,.2);assert.equal(calculateLabMetrics(full).goldShare.value,.2);
 for(const participants of [team().slice(0,4),team().map((p,i)=>i===1?{...p,damageToChampions:null}:p),team().map(p=>({...p,isPlayer:false})),team().map((p,i)=>i===0?{...p,teamId:200}:p)])assert.equal(calculateLabMetrics(match({participants})).damageShare.value,null);
 assert.equal(calculateLabMetrics(match({participants:team().slice(0,4)})).killParticipation.value,null);
 assert.equal(calculateLabMetrics(match({participants:team(),damageToChampions:21000})).damageShare.value,null);
});
test('aggregates separate pooled ratio and average match ratio with independent valid sample sizes',()=>{
 const records=[match(),match({durationSeconds:2400,durationMinutes:40,cs:120,goldEarned:null}),match({cs:900})].map((normalized,i)=>({normalized,metrics:calculateLabMetrics(normalized),coaching:{eligible:i<2}}));
 const aggregate=calculateLabAggregate(records);assert.equal(aggregate.csPerMinute.pooledValue,4);assert.equal(aggregate.csPerMinute.meanValue,4.5);assert.equal(aggregate.csPerMinute.sampleSize,2);assert.equal(aggregate.csPerMinute.numerator,240);assert.equal(aggregate.csPerMinute.denominator,60);assert.equal(aggregate.goldPerMinute.sampleSize,1);
 assert.equal(calculateLabAggregate([]).csPerMinute.pooledValue,null);
});
test('seconds conversion, fallback minutes and overflows never produce nonfinite ratios',()=>{
 assert.equal(calculateLabMetrics(match({durationSeconds:1230,cs:123})).csPerMinute.value,6);
 assert.equal(calculateLabMetrics(match({durationSeconds:undefined,cs:120})).csPerMinute.value,6);
 assert.equal(calculateLabMetrics(match({durationSeconds:Number.MIN_VALUE,cs:Number.MAX_VALUE})).csPerMinute.value,null);
 assert.equal(calculateLabMetrics(match({kills:100,teamKills:5})).killParticipation.status,'inconsistent_data');
});
test('repeated known participant identities invalidate team totals without guessing from equal stats',()=>{
 const unique=team().map((p,i)=>({...p,puuid:`player-${i}`,participantId:i+1,riotId:`Player${i}#TEST`}));
 assert.equal(calculateLabMetrics(match({participants:unique})).damageShare.value,.2);
 for(const key of ['puuid','participantId','riotId']) {
  const duplicate=unique.map((p,i)=>i===2?{...p,[key]:unique[1][key]}:p);
  const metrics=calculateLabMetrics(match({participants:duplicate}));assert.equal(metrics.damageShare.value,null);assert.equal(metrics.killParticipation.value,null);
 }
 assert.equal(calculateLabMetrics(match({participants:team()})).damageShare.value,.2);
});
