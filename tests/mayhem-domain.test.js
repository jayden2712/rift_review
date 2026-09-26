import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeMatch, InputError, SAMPLES} from '../public/data.js';
import {normalizeHistory, exportHistory, historyJsonSource, sampleHistory} from '../public/history-data.js';
import {analyzeHistory, selectMatches, buildTrend, historyReportToMarkdown} from '../public/history-coach.js';
import {generateReport} from '../public/coach.js';
const mayhem=(id,patch={})=>({id,queue:'ARAM Mayhem',champion:'Ahri',result:'Victory',durationMinutes:20,kills:10,deaths:12,assists:20,...patch});
const sr=(id,patch={})=>({...SAMPLES.learning,id,queue:'Ranked Solo',...patch});
const detail={durationSeconds:1200,gameVersion:'16.18.1',participants:[{champion:'Ahri',riotId:'Test#VN',teamId:100,isPlayer:true,kills:10,deaths:12,assists:20,items:[1001,0,null,null,null,null,null],summonerSpells:[4,null],runes:null,augments:null}]};
test('Mayhem accepts absent roles and nullable optional fields without relaxing SR validation',()=>{
 const h=normalizeHistory({matches:[mayhem('m1')]});const m=h.matches[0];
 assert.equal(m.role,null);assert.equal(m.cs,null);assert.equal(m.visionScore,null);assert.equal(m.isRemake,null);assert.equal(h.schemaVersion,3);
 assert.throws(()=>normalizeHistory({matches:[sr('s1',{role:null})]}),InputError);
 assert.throws(()=>normalizeHistory({matches:[mayhem('m1',{queue:'Fake'})]}),InputError);
 assert.equal(normalizeMatch(mayhem('m1')).role,null);
});
test('Mayhem normalizes role to null, validates metadata and never fabricates optional values',()=>{
 const m=normalizeHistory({matches:[mayhem('m1',{role:'Mid',isRemake:false,damageToChampions:0})]}).matches[0];assert.equal(m.role,null);assert.equal(m.damageToChampions,0);assert.equal(m.goldEarned,null);
 for(const patch of [{isRemake:'false'},{kills:null},{damageToChampions:-1},{durationMinutes:0}])assert.throws(()=>normalizeHistory({matches:[mayhem('m1',patch)]}),InputError);
 assert.throws(()=>normalizeHistory({schemaVersion:99,matches:[mayhem('m1')]}),InputError);
});
test('Mayhem and SR selection are isolated, with visible remakes excluded only from aggregates',()=>{
 const h=normalizeHistory({matches:[sr('s1'),mayhem('m1'),mayhem('short',{durationMinutes:3}),mayhem('remake',{isRemake:true}),sr('a1',{queue:'ARAM'})]});
 assert.deepEqual(selectMatches(h).matches.map(m=>m.id),['s1']);
 const r=analyzeHistory(h,{mode:'mayhem'});assert.equal(r.entries.length,3);assert.equal(r.stats.n,2);assert.equal(r.stats.kills,20);assert.equal(r.stats.winRate,1);assert.equal(r.champions[0].stats.n,2);assert.deepEqual(r.roles,[]);assert.equal(r.mode,'mayhem');assert.equal(r.coachingAvailable,false);
 assert.deepEqual(selectMatches(h,{queue:'ARAM Mayhem'}).matches.map(m=>m.id),['m1','short','remake']);
 for(const key of ['findings','strengths','priorities'])assert.deepEqual(r[key],[]);
 assert.equal(r.trend.available,false);assert.ok(r.entries.every(e=>e.mistakes.length===0));
 const markdown=historyReportToMarkdown(r);assert.ok(markdown.includes('ARAM Mayhem'));assert.ok(!markdown.includes('CS/phút'));assert.ok(!markdown.includes('## Ưu tiên'));
});
test('single match report and trend cannot apply SR heuristics to Mayhem',()=>{
 const m=normalizeHistory({matches:[mayhem('m1',{cs:1,visionScore:0,teamKills:100})]}).matches[0];const r=generateReport(m);
 assert.equal(r.coachingAvailable,false);assert.deepEqual(r.mistakes,[]);assert.deepEqual(r.priorities,[]);assert.deepEqual(r.strengths,[]);
 const matches=Array.from({length:12},(_,i)=>({...m,id:`m${i}`,role:'Mid'}));assert.equal(buildTrend(matches,[{name:'Mid'}]).available,false);
 const mixed=Array.from({length:12},(_,i)=>sr(`s${i}`,{queue:i%2?'Ranked Solo':'Ranked Flex'}));assert.equal(buildTrend(mixed,[{name:'Mid'}]).available,false);
});
test('History v3 detail roundtrip preserves validated inventory, missing augments and identity but strips untrusted metadata',async()=>{
 const h=normalizeHistory({schemaVersion:3,profile:{riotId:'Test#VN'},matches:[mayhem('m1')],details:{m1:{...detail,source:'riot',url:'https://example.com',participants:[{...detail.participants[0],source:'riot',icon:'https://example.com'}]}}});
 const exported=exportHistory(h);assert.equal(exported.schemaVersion,3);assert.equal(exported.details.m1.participants[0].augments,null);assert.deepEqual(exported.details.m1.participants[0].items,detail.participants[0].items);assert.equal(exported.details.m1.source,undefined);assert.equal(exported.details.m1.participants[0].icon,undefined);
 assert.deepEqual(await historyJsonSource.load(JSON.stringify(exported)),h);
 for(const schemaVersion of [1,2])assert.equal(normalizeHistory({schemaVersion,matches:[sr('s1')]}).schemaVersion,3);
});
test('detail validator rejects unmatched IDs, malicious keys, oversized arrays and invalid numeric IDs',()=>{
 const rejects=details=>assert.throws(()=>normalizeHistory({matches:[mayhem('m1')],details}),InputError);
 rejects({missing:detail});rejects({m1:{...detail,participants:Array(11).fill(detail.participants[0])}});
 for(const patch of [{teamId:300},{items:['https://bad',0]},{items:[-1]},{summonerSpells:[4,Infinity]},{champion:'x'.repeat(41)},{isPlayer:'true'},{augments:[{id:123}]}])rejects({m1:{...detail,participants:[{...detail.participants[0],...patch}]}});
 rejects(JSON.parse('{"__proto__":{}}'));rejects({m1:{...detail,durationSeconds:-1}});
});
test('detail optional data, rune slots and zero values survive export and legacy normalization',()=>{
 const withRunes={...detail,participants:[{...detail.participants[0],runes:{primaryStyle:8100,secondaryStyle:8200,primary:[8112],secondary:[8226],shards:[5008]},goldEarned:0,championLevel:18}]};
 const h=normalizeHistory({matches:[mayhem('m1')],details:{m1:withRunes}});const p=h.details.m1.participants[0];
 assert.deepEqual(p.runes.primary,[8112,null,null,null]);assert.equal(p.runes.secondary[1],null);assert.equal(p.goldEarned,0);assert.equal(p.cs,null);assert.equal(p.role,null);
 assert.equal(normalizeHistory({matches:[sr('s1')],details:{s1:detail}}).details.s1.participants[0].role,null);
 const empty=normalizeHistory({matches:[mayhem('m1')],details:{m1:{participants:[{}]}}}).details.m1;
 assert.equal(empty.durationSeconds,null);assert.equal(empty.gameVersion,null);assert.deepEqual(empty.participants[0].items,Array(7).fill(null));
 for(const bad of [null,[],{...detail,participants:null},{...detail,gameVersion:'x'.repeat(41)},{...detail,participants:[{...detail.participants[0],runes:[]}]},{...detail,participants:[{...detail.participants[0],role:'Jester'}]},{...detail,participants:[...detail.participants,...detail.participants]}])assert.throws(()=>normalizeHistory({matches:[mayhem('m1')],details:{m1:bad}}),InputError);
});
test('Mayhem aggregation uses optional coverage and has a coherent empty filtered report',()=>{
 const h=normalizeHistory({matches:[mayhem('m1',{deaths:0,teamKills:0,kills:0,assists:0}),mayhem('m2',{damageToChampions:40000,teamKills:50})]});
 const r=analyzeHistory(h,{mode:'mayhem'});assert.equal(r.stats.damage.known,1);assert.equal(r.stats.damage.value,2000);assert.equal(r.stats.participationKnown,1);assert.equal(r.stats.participation,.6);
 const empty=analyzeHistory(h,{mode:'mayhem',champion:'Jinx'});assert.equal(empty.stats.n,0);assert.equal(empty.stats.kda,null);assert.deepEqual(empty.entries,[]);
 const remakes=analyzeHistory(normalizeHistory({matches:[mayhem('r1',{isRemake:true})]}),{mode:'mayhem'});assert.equal(remakes.stats.n,0);assert.equal(remakes.entries.length,1);assert.equal(remakes.remakeCount,1);
});

test('the Mayhem sample is explicitly fictional and contains no borrowed SR roles or fabricated details',()=>{
 const h=sampleHistory('mayhem');assert.equal(h.profile.riotId,'Mayhem Lab#DEMO');assert.equal(h.matches.length,12);assert.deepEqual(h.details,{});assert.ok(h.matches.every(m=>m.queue==='ARAM Mayhem'&&m.role===null&&m.id.startsWith('demo-mayhem-')));assert.equal(analyzeHistory(h,{mode:'mayhem'}).stats.n,12);
});
test('Mayhem has explicit higher score and duration bounds without loosening SR limits',()=>{
 const h=normalizeHistory({matches:[mayhem('high',{durationMinutes:180,kills:1000,deaths:1000,assists:1000,teamKills:5000})],details:{high:{durationSeconds:10800,participants:[{champion:'Ahri',teamId:100,isPlayer:true,kills:1000,deaths:1000,assists:1000}]}}});
 assert.equal(h.matches[0].durationMinutes,180);assert.equal(h.details.high.participants[0].kills,1000);
 for(const patch of [{durationMinutes:181},{kills:1001},{deaths:1001},{assists:1001},{teamKills:5001}])assert.throws(()=>normalizeHistory({matches:[mayhem('bad',patch)]}),InputError);
 for(const patch of [{durationMinutes:91},{kills:101},{deaths:101},{assists:101},{teamKills:201}])assert.throws(()=>normalizeHistory({matches:[sr('bad',patch)]}),InputError);
 for(const patch of [{durationSeconds:10801},{participants:[{kills:1001}]},{participants:[{deaths:1001}]},{participants:[{assists:1001}]}])assert.throws(()=>normalizeHistory({matches:[mayhem('bad')],details:{bad:{...detail,...patch}}}),InputError);
 for(const patch of [{durationSeconds:5401},{participants:[{kills:101}]}])assert.throws(()=>normalizeHistory({matches:[sr('bad')],details:{bad:{...detail,...patch}}}),InputError);
});
