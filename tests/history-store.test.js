import test from 'node:test';
import assert from 'node:assert/strict';
import {SAMPLES} from '../public/data.js';
import {normalizeHistory, exportHistory} from '../public/history-data.js';
import {HISTORY_STORAGE_KEY, HistoryStoreError, loadSavedHistory, saveHistorySnapshot, clearSavedHistory, mergeHistoryPage} from '../public/history-store.js';

const entry=(id,patch={})=>({...SAMPLES.learning,id,queue:'Ranked Solo',playedAt:'2026-09-24T10:00:00Z',...patch});
const history=(matches=[entry('OC1_1')],profile={riotId:'Tester#OCE',region:'OCE'})=>normalizeHistory({profile,matches});
const query={riotId:'Tester#OCE',region:'oce',mode:'sr',count:20,nextStart:20,hasMore:true};
function memoryStorage(initial={}) {
  const values=new Map(Object.entries(initial));
  return {getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};
}

test('snapshot round-trip persists only normalized data and explicitly untrusted device source',()=>{
  const storage=memoryStorage();
  const original={...history(),source:{provider:'riot'},apiKey:'SECRET',profile:{...history().profile,token:'SECRET'}};
  assert.deepEqual(saveHistorySnapshot(original,{...query,apiKey:'SECRET'},storage),{ok:true});
  const saved=loadSavedHistory(storage);
  assert.deepEqual(exportHistory(saved.history),exportHistory(history()));
  assert.deepEqual(saved.query,query);assert.equal(saved.source,'device');
  assert.ok(!storage.getItem(HISTORY_STORAGE_KEY).includes('SECRET'));
  assert.ok(!storage.getItem(HISTORY_STORAGE_KEY).includes('provider'));
  assert.deepEqual(clearSavedHistory(storage),{ok:true});assert.equal(loadSavedHistory(storage),null);
});

test('corrupt, oversized, unsupported and absent snapshots return null without deleting data',()=>{
  for(const raw of ['{broken','null','{}',JSON.stringify({version:99,history:exportHistory(history())}),' '.repeat(2000001)]) {
    const storage=memoryStorage({[HISTORY_STORAGE_KEY]:raw});
    assert.equal(loadSavedHistory(storage),null);assert.equal(storage.getItem(HISTORY_STORAGE_KEY),raw);
  }
  assert.equal(loadSavedHistory(memoryStorage()),null);
});

test('legacy History v2 snapshots normalize through the current domain schema',()=>{
  const old={...exportHistory(history()),schemaVersion:2};
  const storage=memoryStorage({[HISTORY_STORAGE_KEY]:JSON.stringify({version:1,history:old,query:null})});
  const restored=loadSavedHistory(storage);
  assert.equal(restored.history.matches[0].id,'OC1_1');assert.equal(restored.query,null);
});

test('blocked storage and quota failures return explicit errors and preserve old snapshot',()=>{
  const blocked={getItem(){throw new Error('blocked');},setItem(){throw new Error('blocked');},removeItem(){throw new Error('blocked');}};
  assert.equal(loadSavedHistory(blocked),null);
  assert.deepEqual(saveHistorySnapshot(history(),query,blocked),{ok:false,error:'storage_unavailable'});
  assert.deepEqual(clearSavedHistory(blocked),{ok:false,error:'storage_unavailable'});
  const storage=memoryStorage({[HISTORY_STORAGE_KEY]:'old'});
  storage.setItem=()=>{const error=new Error('quota');error.name='QuotaExceededError';throw error;};
  assert.deepEqual(saveHistorySnapshot(history(),query,storage),{ok:false,error:'storage_quota'});
  assert.equal(storage.getItem(HISTORY_STORAGE_KEY),'old');
});

test('global localStorage accessor failures are handled inside the storage boundary',()=>{
  const descriptor=Object.getOwnPropertyDescriptor(globalThis,'localStorage');
  Object.defineProperty(globalThis,'localStorage',{configurable:true,get(){throw new Error('blocked');}});
  try {
    assert.equal(loadSavedHistory(),null);
    assert.deepEqual(saveHistorySnapshot(history(),query),{ok:false,error:'storage_unavailable'});
    assert.deepEqual(clearSavedHistory(),{ok:false,error:'storage_unavailable'});
  } finally {
    if(descriptor)Object.defineProperty(globalThis,'localStorage',descriptor);else delete globalThis.localStorage;
  }
});

test('invalid history/query never replace saved data; imported data may omit resume query',()=>{
  const storage=memoryStorage({[HISTORY_STORAGE_KEY]:'old'});
  assert.deepEqual(saveHistorySnapshot({},query,storage),{ok:false,error:'invalid_history'});
  for(const patch of [{mode:'other'},{count:99},{nextStart:-1},{hasMore:'yes'},{riotId:'Other#ID'}]) {
    assert.deepEqual(saveHistorySnapshot(history(),{...query,...patch},storage),{ok:false,error:'invalid_query'});
    assert.equal(storage.getItem(HISTORY_STORAGE_KEY),'old');
  }
  assert.deepEqual(saveHistorySnapshot(history(),null,storage),{ok:true});
  assert.equal(loadSavedHistory(storage).query,null);
});

test('merge deduplicates refreshed pages, keeps user notes, sorts deterministically and does not mutate inputs',()=>{
  const old=history([entry('OC1_1',{notes:'My note',kills:3}),entry('OC1_2',{playedAt:'2026-09-23T10:00:00Z'})]);
  const incoming=history([entry('OC1_1',{kills:7,notes:''}),entry('OC1_3',{playedAt:'2026-09-22T10:00:00Z'})]);
  const before=JSON.stringify({old,incoming});const merged=mergeHistoryPage(old,incoming);
  assert.deepEqual(merged.matches.map(match=>match.id),['OC1_1','OC1_2','OC1_3']);
  assert.equal(merged.matches[0].kills,7);assert.equal(merged.matches[0].notes,'My note');
  assert.equal(JSON.stringify({old,incoming}),before);
});

test('merge enforces account identity, rejects duplicate conflicts and preserves existing data at the 500 limit',()=>{
  const old=history();
  for(const profile of [{riotId:'Someone#OCE',region:'OCE'},{riotId:'Tester#OCE',region:'EUW'}])
    assert.throws(()=>mergeHistoryPage(old,history([entry('OC1_2')],profile)),error=>error instanceof HistoryStoreError&&error.code==='account_mismatch');
  assert.equal(mergeHistoryPage(old,history([entry('OC1_2')],{riotId:'tester#oce',region:'oce'})).matches.length,2);
  for(const patch of [{champion:'Jinx'},{queue:'Ranked Flex'}])
    assert.throws(()=>mergeHistoryPage(old,history([entry('OC1_1',patch)])),error=>error.code==='match_conflict');
  const full=history(Array.from({length:500},(_,i)=>entry('OC1_'+i)));
  assert.throws(()=>mergeHistoryPage(full,history([entry('OC1_501')])),error=>error.code==='history_limit');
  assert.equal(full.matches.length,500);
});

test('serialized size limit rejects large snapshots instead of truncating matches',()=>{
  const large=history(Array.from({length:500},(_,i)=>entry('OC1_'+i,{notes:'ậ'.repeat(2000)})));
  const storage=memoryStorage({[HISTORY_STORAGE_KEY]:'old'});
  assert.deepEqual(saveHistorySnapshot(large,null,storage),{ok:false,error:'history_too_large'});
  assert.equal(storage.getItem(HISTORY_STORAGE_KEY),'old');
});

test('Mayhem snapshots preserve sanitized details, query and notes through refresh and reload',()=>{
  const match=id=>entry(id,{queue:'ARAM Mayhem',role:null});
  const details={OC1_1:{durationSeconds:1680,gameVersion:'16.18.1',participants:[{champion:'Ahri',riotId:'Tester#OCE',teamId:100,isPlayer:true,items:[1001],summonerSpells:[4],apiKey:'SECRET',puuid:'SECRET'}],provider:'riot'}};
  const old=normalizeHistory({profile:history().profile,matches:[match('OC1_1')],details});
  const next=normalizeHistory({profile:history().profile,matches:[match('OC1_2')]});
  const merged=mergeHistoryPage(old,next);
  assert.deepEqual(merged.details.OC1_1,old.details.OC1_1);
  const storage=memoryStorage();
  assert.deepEqual(saveHistorySnapshot(merged,{...query,mode:'mayhem'},storage),{ok:true});
  const restored=loadSavedHistory(storage);
  assert.equal(restored.query.mode,'mayhem');
  assert.deepEqual(restored.history.details,merged.details);
  assert.ok(!storage.getItem(HISTORY_STORAGE_KEY).includes('SECRET'));
  const revised=normalizeHistory({profile:history().profile,matches:[match('OC1_1')],details:{OC1_1:{...details.OC1_1,durationSeconds:1700}}});
  assert.equal(mergeHistoryPage(merged,revised).details.OC1_1.durationSeconds,1700);
  assert.throws(()=>mergeHistoryPage(old,history()),error=>error.code==='mode_mismatch');
  const mixed=normalizeHistory({profile:history().profile,matches:[match('OC1_3'),entry('OC1_4')]});
  assert.throws(()=>mergeHistoryPage(mixed,next),error=>error.code==='mode_mismatch');
});


test('resume queries enforce known region, matching profile region and bounded API cursor',()=>{
  const regions=['oce','vn','kr','jp','na','br','lan','las','euw','eune','tr','ru','sg','tw'];
  for(const region of regions) {
    const storage=memoryStorage();
    const regional=history(undefined,{riotId:query.riotId,region:region.toUpperCase()});
    assert.deepEqual(saveHistorySnapshot(regional,{...query,region,nextStart:500,hasMore:false},storage),{ok:true});
    assert.equal(loadSavedHistory(storage).query.region,region);
  }
  for(const patch of [{region:'oc1'},{region:'invalid'},{region:'vn'},{region:'OCE'},{nextStart:501},{nextStart:100000},{nextStart:500,hasMore:true}]) {
    const storage=memoryStorage({[HISTORY_STORAGE_KEY]:'old'});
    assert.deepEqual(saveHistorySnapshot(history(),{...query,...patch},storage),{ok:false,error:'invalid_query'});
    assert.equal(storage.getItem(HISTORY_STORAGE_KEY),'old');
  }
  const tampered={version:1,history:exportHistory(history()),query:{...query,region:'vn'}};
  assert.equal(loadSavedHistory(memoryStorage({[HISTORY_STORAGE_KEY]:JSON.stringify(tampered)})),null);
});

test('refresh prepends unseen games when an undated entry prevents chronological sorting; older pages append',()=>{
  const existing=history([entry('old-1',{notes:'Keep my note'}),entry('manual',{playedAt:null})]);
  const incoming=history([entry('new-1',{playedAt:'2026-09-26T10:00:00Z'}),entry('new-2',{playedAt:'2026-09-25T10:00:00Z'}),entry('old-1',{kills:7,notes:''})]);
  const before=JSON.stringify({existing,incoming});
  const refreshed=mergeHistoryPage(existing,incoming,{prependNew:true});
  assert.deepEqual(refreshed.matches.map(match=>match.id),['new-1','new-2','old-1','manual']);
  assert.equal(refreshed.ordering,'input');
  assert.equal(refreshed.matches[2].notes,'Keep my note');
  assert.equal(refreshed.matches[2].kills,7);
  const older=history([entry('old-2',{playedAt:'2026-09-20T10:00:00Z'})]);
  assert.deepEqual(mergeHistoryPage(existing,older).matches.map(match=>match.id),['old-1','manual','old-2']);
  assert.deepEqual(mergeHistoryPage(existing,incoming,{prependNew:false}).matches.map(match=>match.id),['old-1','manual','new-1','new-2']);
  assert.equal(JSON.stringify({existing,incoming}),before);
});

test('explicit mixed-history refresh retains the other mode and persists a matching resume query',()=>{
  const mixed=history([entry('sr-1',{playedAt:null,notes:'SR note'}),entry('mayhem-1',{queue:'ARAM Mayhem',notes:'Mayhem note'})]);
  const incoming=history([entry('mayhem-2',{queue:'ARAM Mayhem'}),entry('mayhem-1',{queue:'ARAM Mayhem',notes:'',kills:9})]);
  assert.throws(()=>mergeHistoryPage(mixed,incoming),error=>error.code==='mode_mismatch');
  const merged=mergeHistoryPage(mixed,incoming,{allowMixed:true,prependNew:true});
  assert.deepEqual(merged.matches.map(match=>match.id),['mayhem-2','sr-1','mayhem-1']);
  assert.deepEqual(merged.matches[1],{...mixed.matches[0],inputIndex:1});
  assert.equal(merged.matches[2].notes,'Mayhem note');assert.equal(merged.matches[2].kills,9);
  for(const mode of ['sr','mayhem']) {
    const storage=memoryStorage();
    assert.deepEqual(saveHistorySnapshot(merged,{...query,mode},storage),{ok:true});
    assert.equal(loadSavedHistory(storage).query.mode,mode);
    assert.deepEqual(loadSavedHistory(storage).history,merged);
  }
  const srRefresh=history([entry('sr-2')]);
  assert.equal(mergeHistoryPage(mixed,srRefresh,{allowMixed:true}).matches.length,3);
  assert.throws(()=>mergeHistoryPage(history(),incoming,{allowMixed:true}),error=>error.code==='mode_mismatch');
  assert.throws(()=>mergeHistoryPage(mixed,mixed,{allowMixed:true}),error=>error.code==='mode_mismatch');
  const conflicting=history([entry('sr-1',{queue:'ARAM Mayhem'})]);
  assert.throws(()=>mergeHistoryPage(mixed,conflicting,{allowMixed:true}),error=>error.code==='match_conflict');
});
