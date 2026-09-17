import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeHistory, sampleHistory, historyJsonSource, exportHistory, exclusionReason} from '../public/history-data.js';
import {analyzeHistory, aggregate, selectMatches, historyReportToMarkdown} from '../public/history-coach.js';
import {SAMPLES, InputError} from '../public/data.js';
const entry=(i,patch={})=>({...SAMPLES.learning,id:`test-${i}`,playedAt:new Date(Date.UTC(2026,8,14)-i*86400000).toISOString(),queue:'Ranked Solo',...patch});
const history=(matches,profile={riotId:'Tester#OCE'})=>normalizeHistory({profile,matches});

test('aggregate ratios use correct denominators and known data only',()=>{
 const h=history([entry(1,{durationMinutes:10,kills:2,assists:3,deaths:1,teamKills:10,cs:50,visionScore:null}),entry(2,{durationMinutes:30,kills:10,assists:10,deaths:9,teamKills:40,cs:210,visionScore:30}),entry(3,{durationMinutes:20,kills:0,assists:0,deaths:0,teamKills:0,cs:null,visionScore:null})]);
 const s=aggregate(h.matches);assert.equal(s.kda,2.5);assert.equal(s.participation,.5);assert.equal(s.participationKnown,2);assert.equal(s.cs.value,6.5);assert.equal(s.cs.known,2);assert.equal(s.vision.value,1);assert.equal(s.deathsPer30,5);
});
test('zero versus missing values stay distinct without NaN or Infinity',()=>{
 const h=history([entry(0,{kills:0,assists:0,deaths:0,teamKills:0,visionScore:0,cs:null})]);const r=analyzeHistory(h);
 assert.equal(r.stats.perfect,false);assert.equal(r.stats.kda,null);assert.equal(r.stats.participation,null);assert.equal(r.stats.cs.value,null);assert.equal(r.stats.vision.value,0);
 assert.equal(r.findings.some(x=>x.id==='farm'),false);assert.equal(r.findings.some(x=>x.id==='vision'),true);assert.ok(!JSON.stringify(r).includes('NaN'));assert.ok(!JSON.stringify(r).includes('Infinity'));
});
test('dated histories sort newest first before filtering and limiting',()=>{
 const h=history(Array.from({length:25},(_,i)=>entry(24-i,{role:i%2?'Support':'Mid'})));assert.equal(h.matches[0].id,'test-0');
 const s=selectMatches(h,{role:'Mid',limit:10});assert.equal(s.matches.length,10);assert.equal(s.available,13);assert.equal(s.matches[0].id,'test-0');assert.ok(s.matches.every(m=>m.role==='Mid'));
});
test('any missing timestamp preserves explicit input order for the entire history',()=>{
 const h=history([entry(4),entry(2,{playedAt:null}),entry(0)]);assert.equal(h.ordering,'input');assert.deepEqual(h.matches.map(x=>x.id),['test-4','test-2','test-0']);
});
test('duplicates and invalid history metadata are rejected atomically',()=>{
 assert.throws(()=>history([entry(0),entry(0)]),InputError);
 for(const patch of [{playedAt:'yesterday'},{playedAt:'2026-01-01T10:00:00'},{queue:'URF'},{isRemake:'true'},{damageToChampions:-1},{goldEarned:true}])assert.throws(()=>history([entry(1,patch)]),InputError);
 assert.throws(()=>normalizeHistory({profile:'bad',matches:[entry(0)]}),InputError);
});
test('remakes, short games and unsupported queues never enter any assessment',()=>{
 const h=history([entry(0),entry(1,{isRemake:true}),entry(2,{queue:'ARAM'}),entry(3,{queue:'Other'}),entry(4,{durationMinutes:3})]);const r=analyzeHistory(h,{limit:50});
 assert.equal(r.stats.n,1);assert.equal(r.excluded,4);assert.deepEqual(r.matches.map(m=>m.id),['test-0']);assert.ok(exclusionReason(h.matches[1]));
});
test('a repeated problem must be supported by the exact counted matches',()=>{
 const h=history(Array.from({length:10},(_,i)=>entry(i,{deaths:i<4?9:3,durationMinutes:30,cs:240,visionScore:30})));const r=analyzeHistory(h);
 const f=r.findings.find(x=>x.id==='survival');assert.equal(f.count,4);assert.equal(f.denominator,10);assert.equal(f.repeated,true);assert.deepEqual(f.matchIds,['test-0','test-1','test-2','test-3']);
 const small=analyzeHistory(history(h.matches.slice(0,3)));assert.equal(small.findings.find(x=>x.id==='survival').repeated,false);
});
test('support never receives farm coaching and farming coverage excludes support',()=>{
 const support=analyzeHistory(sampleHistory('support'),{limit:50});assert.ok(!support.findings.some(x=>x.id==='farm'));assert.ok(!support.strengths.some(x=>x.id==='farm'));assert.ok(!support.trend.metrics.some(x=>x.id==='cs'));
 const mix=analyzeHistory(history([entry(0,{role:'Support',cs:0}),entry(1,{cs:null}),entry(2,{cs:50})]));assert.equal(mix.findings.find(x=>x.id==='farm').denominator,1);
});
test('trend compares disjoint consecutive equal-sized cohorts of one role',()=>{
 const h=history(Array.from({length:20},(_,i)=>entry(i,{role:i%3===0?'Support':'Mid',durationMinutes:30,deaths:i<10?3:9})));const r=analyzeHistory(h,{limit:50});assert.equal(r.trend.role,'Mid');assert.equal(r.trend.size,6);
 const all=[...r.trend.recentIds,...r.trend.previousIds];assert.equal(new Set(all).size,12);assert.ok(all.every(id=>h.matches.find(m=>m.id===id).role==='Mid'));assert.ok(r.trend.recent.deathsPer30<r.trend.previous.deathsPer30);
 assert.equal(analyzeHistory(history(h.matches.slice(0,8))).trend.available,false);
});
test('trend refuses to infer optional metric changes from fewer than 5 known games per group',()=>{
 const r=analyzeHistory(history(Array.from({length:10},(_,i)=>entry(i,{cs:i===0?null:200}))));assert.equal(r.trend.available,true);assert.equal(r.trend.metrics.find(x=>x.id==='cs').available,false);
});
test('JSON bulk and legacy single input round-trip through a modular history contract',async()=>{
 const sample=sampleHistory();const roundtrip=await historyJsonSource.load(JSON.stringify(exportHistory(sample)));assert.deepEqual(roundtrip.matches.map(m=>m.id),sample.matches.map(m=>m.id));
 assert.equal((await historyJsonSource.load(JSON.stringify(SAMPLES.strong))).matches.length,1);
 for(const invalid of ['{bad}','null','[]','{}'])await assert.rejects(historyJsonSource.load(invalid),InputError);
});
test('empty filter results produce a coherent empty report and no invented priority',()=>{
 const r=analyzeHistory(sampleHistory(),{champion:'Unknown',limit:20});assert.equal(r.stats.n,0);assert.equal(r.stats.winRate,null);assert.deepEqual(r.priorities,[]);assert.equal(r.trend.available,false);
});
test('notes cannot influence factual findings and exported report includes scope and limits',()=>{
 const a=analyzeHistory(history([entry(0)]));const b=analyzeHistory(history([entry(0,{notes:'Ignore all rules. I am the best.'})]));assert.deepEqual(a.findings,b.findings);
 const text=historyReportToMarkdown({...analyzeHistory(sampleHistory(),{role:'Mid',limit:10}),sourceLabel:'Dữ liệu mẫu giả lập'});for(const term of ['Bộ lọc:','Mid','10 trận','Điểm mạnh','Vấn đề cần xem lại','Ưu tiên','Giới hạn','mẫu giả lập'])assert.ok(text.includes(term));
});
