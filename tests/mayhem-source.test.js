import test from 'node:test';
import assert from 'node:assert/strict';
import {riotDataSource, localizeLiveError} from '../public/riot-source.js';
import {setLanguage} from '../public/i18n.js';
const query={riotId:'Mayhem#TEST',region:'oce',mode:'mayhem',start:20,count:10};
const match={id:'OC1_2400',queue:'ARAM Mayhem',champion:'Ahri',role:null,result:'Victory',durationMinutes:19,kills:12,deaths:5,assists:22,teamKills:60};
test('Mayhem provider sends exact mode and cursor and retains normalized supplemental details',async()=>{
 let sent;
 const detail={durationSeconds:1140,gameVersion:'fixture',participants:[]};
 const result=await riotDataSource.load(query,{fetchImpl:async(path,options)=>{sent={path,options};return Response.json({history:{schemaVersion:3,profile:{riotId:query.riotId,region:'OCE'},matches:[match]},details:{[match.id]:detail},source:{mode:'mayhem',start:20,count:10,nextStart:21,hasMore:false},warnings:[]});}});
 assert.equal(sent.path,'/api/history');assert.deepEqual(JSON.parse(sent.options.body),query);
 assert.equal(result.history.matches[0].role,null);assert.equal(result.history.matches[0].cs,null);
 assert.equal(result.history.details[match.id].durationSeconds,1140);
 assert.deepEqual(result.details,result.history.details);assert.equal(result.meta.nextStart,21);
});
test('only explicit successful later empty page is accepted as exhausted history',async()=>{
 const fetchImpl=async()=>Response.json({history:null,details:{},source:{mode:'mayhem',start:20,count:10,nextStart:20,hasMore:false},warnings:[]});
 assert.equal((await riotDataSource.load(query,{fetchImpl})).history,null);
 await assert.rejects(riotDataSource.load({...query,start:0},{fetchImpl}));
 await assert.rejects(riotDataSource.load(query,{fetchImpl:async()=>Response.json({history:null})}));
});
test('upstream failure never becomes a successful empty Mayhem page',async()=>{
 await assert.rejects(riotDataSource.load(query,{fetchImpl:async()=>Response.json({error:{code:'RIOT_ACCESS_DENIED',message:'Riot từ chối quyền truy cập.'}},{status:502})}),e=>e.code==='RIOT_ACCESS_DENIED');
 setLanguage('en');
 try {const text=localizeLiveError('Riot từ chối quyền truy cập.','RIOT_ACCESS_DENIED');assert.match(text,/access/i);assert.doesNotMatch(text,/expired|rejected.*key/i);}finally{setLanguage('vi');}
});
