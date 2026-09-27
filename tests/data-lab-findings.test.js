import test from 'node:test';
import assert from 'node:assert/strict';
import {setLanguage} from '../public/i18n.js';
import {createLabSnapshot} from '../public/data-lab-model.js';
import {analyzeLabSnapshot,exportCoachingInput} from '../public/data-lab-findings.js';
const match=(id,extra={})=>({id,playedAt:'2026-09-20T12:00:00Z',champion:'Ahri',role:'Mid',queue:'Ranked Solo',result:'Defeat',durationMinutes:30,kills:2,deaths:10,assists:3,cs:90,visionScore:5,teamKills:30,isRemake:false,...extra});
const snapshot=(matches)=>createLabSnapshot({matches});

test('findings reference the exact selected match metric, its formula and scope without mutating the snapshot',()=>{
 const data=snapshot([match('m1'),match('m2',{kills:4})]);const before=JSON.stringify(data);const analysis=analyzeLabSnapshot(data);
 assert.equal(analysis.scope.eligibleCount,2);assert.equal(analysis.scope.selectedCount,2);assert.equal(analysis.findings.filter(f=>f.type==='observed').length,4);
 for(const finding of analysis.findings){assert.ok(finding.id);assert.ok(finding.matchIds.length);for(const evidence of finding.evidence){const record=data.records.find(r=>r.matchId===evidence.matchId);assert.ok(record);assert.equal(evidence.value,record.metrics[evidence.metricId].value);assert.equal(evidence.formula,record.metrics[evidence.metricId].formula);assert.equal(evidence.unit,record.metrics[evidence.metricId].unit);assert.equal(evidence.sample.selectedCount,2);assert.ok(finding.matchIds.includes(evidence.matchId));}}
 assert.equal(before,JSON.stringify(data));
});

test('excluded records remain visible but never contribute to metrics, rules or evidence',()=>{
 const data=snapshot([match('valid'),match('remake',{isRemake:true}),match('unknown-role',{role:null}),match('mayhem',{queue:'ARAM Mayhem'}),match('short',{durationMinutes:3})]);
 const result=analyzeLabSnapshot(data);assert.equal(result.records.length,5);assert.equal(result.scope.eligibleCount,1);assert.equal(result.scope.excludedCount,4);assert.equal(result.aggregate.csPerMinute.sampleSize,1);
 assert.ok(result.findings.every(f=>f.matchIds.every(id=>id==='valid')));
});

test('Support never receives farming findings and vision uses its own illustrative threshold',()=>{
 const support=analyzeLabSnapshot(snapshot([match('support',{role:'Support',cs:0,visionScore:24})]));
 assert.ok(!support.findings.some(f=>f.topic==='farm'));assert.ok(support.findings.some(f=>f.topic==='vision'&&f.type==='recommendation'));
 const mid=analyzeLabSnapshot(snapshot([match('mid',{visionScore:24})]));assert.ok(!mid.findings.some(f=>f.topic==='vision'&&f.type==='recommendation'));
});

test('filters and limits apply to the same rows used for evidence and aggregate',()=>{
 const rows=Array.from({length:15},(_,i)=>match(`m${String(i).padStart(2,'0')}`,{champion:i===14?'Jinx':'Ahri',queue:i===13?'Ranked Flex':'Ranked Solo',result:i===12?'Victory':'Defeat',playedAt:new Date(Date.UTC(2026,8,1+i)).toISOString()}));
 const result=analyzeLabSnapshot(snapshot(rows),{role:'Mid',champion:'Ahri',queue:'Ranked Solo',result:'Defeat',limit:10});
 assert.equal(result.scope.inputCount,15);assert.equal(result.scope.filteredCount,12);assert.equal(result.scope.selectedCount,10);assert.equal(result.scope.matchIds[0],'m11');assert.equal(result.aggregate.csPerMinute.sampleSize,10);
 assert.ok(result.findings.every(f=>f.matchIds.every(id=>result.scope.matchIds.includes(id))));
});

test('sorting is deterministic, missing values always last, and unsafe sort keys use the default',()=>{
 const data=snapshot([match('b',{cs:0}),match('c',{cs:null}),match('a',{cs:0})]);
 assert.deepEqual(analyzeLabSnapshot(data,{sortBy:'csPerMinute',direction:'asc'}).scope.matchIds,['a','b','c']);
 assert.deepEqual(analyzeLabSnapshot(data,{sortBy:'csPerMinute',direction:'desc'}).scope.matchIds,['a','b','c']);
 const unsafe=analyzeLabSnapshot(data,{sortBy:'__proto__',direction:'other',limit:500});assert.equal(unsafe.scope.sortBy,'playedAt');assert.equal(unsafe.scope.direction,'desc');assert.equal(unsafe.scope.limit,20);
});

test('zero denominators and absent fields are missing evidence, not fabricated zero measurements',()=>{
 const result=analyzeLabSnapshot(snapshot([match('missing',{cs:null,visionScore:null,teamKills:0,kills:0,assists:0,deaths:0})]));
 assert.ok(!result.findings.some(f=>['farm','vision','involvement'].includes(f.topic)));assert.ok(result.missingData.some(m=>m.matchId==='missing'&&m.metricId==='killParticipation'&&m.status==='zero_denominator'));assert.equal(result.aggregate.killParticipation.sampleSize,0);
 assert.equal(result.findings[0].evidence[0].value,0);
});

test('coaching input is a detached structured data export and never includes raw payloads or unknown fields',()=>{
 const analysis=analyzeLabSnapshot(snapshot([match('one')]));const exported=exportCoachingInput(analysis);
 assert.equal(exported.schemaVersion,2);assert.equal(exported.kind,'rift-review-coaching-input');assert.deepEqual(exported.engine,{type:'rules',version:'1.0',llmUsed:false,heuristic:true});assert.equal(exported.matches[0].matchId,'one');assert.ok(exported.matches[0].metrics);assert.equal(exported.matches[0].raw,undefined);assert.deepEqual(exported.scope,analysis.scope);
 exported.matches[0].normalized.champion='Changed';assert.equal(analysis.records[0].normalized.champion,'Ahri');
 const serialized=JSON.stringify(exported);assert.ok(!serialized.includes('NaN'));assert.ok(!serialized.includes('Infinity'));
});

test('English and Vietnamese retain identical evidence and IDs; copy states uncertainty and heuristic limits',()=>{
 try{setLanguage('vi');const vi=analyzeLabSnapshot(snapshot([match('one')]));setLanguage('en');const en=analyzeLabSnapshot(snapshot([match('one')]));assert.notEqual(vi.findings[0].statement,en.findings[0].statement);assert.deepEqual(vi.findings.map(f=>f.id),en.findings.map(f=>f.id));assert.deepEqual(vi.findings.map(f=>f.evidence),en.findings.map(f=>f.evidence));assert.ok(en.limitations.some(l=>l.includes('illustrative')));assert.ok(en.limitations.some(l=>l.includes('No timeline')));assert.ok(en.findings.some(f=>f.type==='hypothesis'&&f.statement.includes('cannot establish')));}finally{setLanguage('vi');}
});

test('an empty filtered cohort has no invented findings or aggregate values',()=>{
 const analysis=analyzeLabSnapshot(snapshot([match('one')]),{champion:'Jinx'});assert.deepEqual(analysis.records,[]);assert.deepEqual(analysis.findings,[]);assert.equal(analysis.aggregate.csPerMinute.pooledValue,null);assert.deepEqual(exportCoachingInput(analysis).matches,[]);
});

test('numeric and text columns sort within the selected cohort with stable evidence IDs',()=>{
 const data=snapshot([match('low',{champion:'Ahri',cs:60}),match('high',{champion:'Jinx',cs:240}),match('unknown',{champion:'Zed',cs:null})]);
 assert.deepEqual(analyzeLabSnapshot(data,{sortBy:'csPerMinute',direction:'desc'}).scope.matchIds,['high','low','unknown']);
 assert.deepEqual(analyzeLabSnapshot(data,{sortBy:'champion',direction:'asc'}).scope.matchIds,['low','high','unknown']);
 const first=analyzeLabSnapshot(data,{sortBy:'csPerMinute',direction:'asc'}).findings.find(f=>f.topic==='farm'&&f.type==='observed');
 const second=analyzeLabSnapshot(data,{sortBy:'csPerMinute',direction:'desc'}).findings.find(f=>f.topic==='farm'&&f.type==='observed');
 assert.deepEqual(first.evidence.map(e=>e.id).sort(),second.evidence.map(e=>e.id).sort());
 assert.equal(new Set(first.evidence.map(e=>e.id)).size,first.evidence.length);
});

test('missing-data export distinguishes unknown remake, not-loaded timeline and uncollected fields',()=>{
 const analysis=analyzeLabSnapshot(snapshot([match('unknown',{isRemake:null,visionScore:null})]));const output=exportCoachingInput(analysis);
 assert.ok(output.missingData.some(entry=>entry.field==='visionScore'&&entry.status==='not_collected'&&entry.affects.includes('visionPerMinute')));
 assert.ok(output.missingData.some(entry=>entry.field==='isRemake'&&entry.status==='unknown'&&entry.unknownPolicy==='allow_if_other_criteria_pass'));
 assert.ok(output.missingData.some(entry=>entry.field==='timeline'&&entry.status==='not_loaded'));
 assert.equal(output.scope.eligibleCount,1);assert.equal(output.matches[0].normalized.isRemake,null);
 try{setLanguage('en');const english=analyzeLabSnapshot(snapshot([match('unknown',{isRemake:null})]));assert.ok(english.limitations.some(line=>line.includes('Unknown remake status is allowed')));assert.ok(english.findings.every(f=>f.limitations.some(line=>line.includes('Unknown remake status is allowed'))));}finally{setLanguage('vi');}
});

test('deathless KDA is a known edge case, not a missing-data field',()=>{
 const analysis=analyzeLabSnapshot(snapshot([match('deathless',{deaths:0})]));assert.equal(analysis.records[0].metrics.kda.status,'deathless');assert.ok(!analysis.missingData.some(entry=>entry.metricId==='kda'));
});
