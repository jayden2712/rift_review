// Synthetic end-to-end check. Never loads .env or contacts Riot.
// Install Playwright separately and set PLAYWRIGHT_MODULE to its index.mjs if needed.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createLocalServer} from '../../server/local.js';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const fixture=JSON.parse(await readFile(new URL('../fixtures/mayhem-match.json',import.meta.url),'utf8'));
const upstream=[];
const server=createLocalServer({env:{RIOT_API_KEY:'fixture-not-a-real-key'},fetchImpl:async address=>{
 const url=new URL(address);upstream.push(url);
 if(url.pathname.includes('/accounts/'))return Response.json({puuid:'fixture-mayhem-player',gameName:'Mayhem',tagLine:'TEST'});
 if(url.pathname.includes('/summoner/'))return Response.json({puuid:'fixture-mayhem-player'});
 if(url.pathname.endsWith('/ids')){
  assert.equal(url.searchParams.get('queue'),'2400');const start=Number(url.searchParams.get('start'));
  return Response.json(start===0?Array.from({length:10},(_,i)=>`OC1_${240001+i}`):start===10?Array.from({length:10},(_,i)=>`OC1_${240010+i}`):[]);
 }
 const id=url.pathname.split('/').at(-1),index=Number(id.split('_')[1])-240001;
 return Response.json({...fixture,metadata:{matchId:id},info:{...fixture.info,gameStartTimestamp:fixture.info.gameStartTimestamp-index*3600000}});
}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
const errors=[];
try{
 const context=await browser.newContext({viewport:{width:1440,height:1000}});
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.goto(origin);await page.waitForSelector('.match-row');
 assert.match(await page.locator('#scope').innerText(),/Đánh giá/);
 await page.locator('#riot-lookup [name=riotId]').fill('Mayhem#TEST');
 await page.locator('#lookup-mode').selectOption('mayhem');await page.locator('#riot-lookup [name=count]').selectOption('10');
 const post=page.waitForRequest(request=>request.url().endsWith('/api/history'));
 await page.locator('#lookup-button').click();assert.equal((await post).postDataJSON().mode,'mayhem');
 await page.waitForFunction(()=>document.querySelector('#storage-status').textContent.includes('Đã lưu'));
 assert.equal(await page.locator('#queue-filter').inputValue(),'ARAM Mayhem');
 assert.equal(await page.locator('#coaching-tab').isDisabled(),true);
 assert.equal(await page.locator('#role-filter').isDisabled(),true);
 assert.equal(await page.locator('[data-load-rank]').count(),0);
 assert.equal(await page.locator('.match-row').count(),10);
 await page.locator('.match-row summary').first().click();
 assert.equal(await page.locator('.participant-team').count(),20);
 assert.match(await page.locator('.match-detail').first().innerText(),/Chưa xác minh dữ liệu nâng cấp/);
 assert.doesNotMatch(await page.locator('#match-list').innerText(),/Ngưỡng riêng cho Support|Tín hiệu của trận này/);
 await page.locator('[data-language=en]').click();
 assert.match(await page.locator('#focus-preview').innerText(),/statistics only/);
 assert.match(await page.locator('.match-detail').first().innerText(),/Augment data has not been verified/);
 await page.locator('#load-older').click();
 await page.waitForFunction(()=>document.querySelector('#scope').textContent.includes('19 Mayhem'));
 assert.equal(await page.locator('#limit-filter').inputValue(),'500');
 let saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('rift-review-history-v1')));
 assert.equal(saved.history.matches.length,19);assert.equal(new Set(saved.history.matches.map(m=>m.id)).size,19);
 assert.equal(Object.keys(saved.history.details).length,19);assert.equal(saved.query.nextStart,20);
 await page.locator('#load-older').click();await page.waitForFunction(()=>document.querySelector('#load-older').hidden);
 assert.match(await page.locator('#sync-context').innerText(),/No more/);
 await page.reload();await page.waitForSelector('.match-row');
 assert.equal(await page.locator('html').getAttribute('lang'),'en');
 assert.match(await page.locator('#source-banner').innerText(),/Saved device history/);
 await page.locator('#limit-filter').selectOption('500');
 assert.match(await page.locator('#scope').innerText(),/19 Mayhem/);
 // A failed sync leaves both the visible history and saved snapshot intact.
 const previous=await page.evaluate(()=>localStorage.getItem('rift-review-history-v1'));
 await page.route('**/api/history',route=>route.fulfill({status:502,contentType:'application/json',body:JSON.stringify({error:{code:'RIOT_ACCESS_DENIED',message:'Riot từ chối quyền truy cập dữ liệu này.'}})}));
 await page.locator('#lookup-button').click();await page.waitForFunction(()=>document.querySelector('#lookup-status').classList.contains('lookup-error'));
 assert.match(await page.locator('#lookup-status').innerText(),/denied access/);
 assert.equal(await page.evaluate(()=>localStorage.getItem('rift-review-history-v1')),previous);
 await page.unroute('**/api/history');
 // Manual undated Mayhem entry survives a subsequent refresh and JSON round-trip.
 await page.locator('#add-match').click();assert.equal(await page.locator('#manual-form [name=role]').isDisabled(),true);
 for(const [field,value] of Object.entries({champion:'Jinx',durationMinutes:'22',kills:'10',deaths:'7',assists:'18',notes:'Ghi chú <b>giữ nguyên</b>'}))await page.locator(`#manual-form [name=${field}]`).fill(value);
 await page.locator('#manual-form button[type=submit]').click();await page.waitForFunction(()=>!document.querySelector('#input-dialog').open);
 saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('rift-review-history-v1')));assert.equal(saved.history.matches.length,20);
 await page.locator('#lookup-button').click();await page.waitForFunction(()=>!document.querySelector('#lookup-button').disabled);
 saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('rift-review-history-v1')));assert.equal(saved.history.matches.length,20);assert.ok(saved.history.matches.some(m=>m.notes.includes('<b>giữ nguyên</b>')));
 await page.locator('#import-history').click();await page.locator('#use-current').click();
 const exported=JSON.parse(await page.locator('#json-input').inputValue());assert.equal(exported.schemaVersion,3);assert.equal(Object.keys(exported.details).length,19);
 await page.locator('#apply-json').click();await page.waitForFunction(()=>!document.querySelector('#input-dialog').open);
 await page.locator('#lookup-button').click();await page.waitForFunction(()=>!document.querySelector('#lookup-button').disabled);
 assert.equal((await page.evaluate(()=>JSON.parse(localStorage.getItem('rift-review-history-v1')))).history.matches.length,20);
 // Mixed JSON keeps its SR records when refreshing just the Mayhem cohort.
 const mixed={...exported,matches:[...exported.matches,{...exported.matches[0],id:'manual-ranked-1',queue:'Ranked Solo',role:'Mid',isRemake:false}]};
 await page.locator('#import-history').click();await page.locator('#json-input').fill(JSON.stringify(mixed));await page.locator('#apply-json').click();await page.waitForFunction(()=>!document.querySelector('#input-dialog').open);
 await page.locator('#queue-filter').selectOption('ARAM Mayhem');
 await page.locator('#lookup-button').click();await page.waitForFunction(()=>!document.querySelector('#lookup-button').disabled);
 const mixedSaved=await page.evaluate(()=>JSON.parse(localStorage.getItem('rift-review-history-v1')));
 assert.equal(mixedSaved.history.matches.length,21);assert.ok(mixedSaved.history.matches.some(m=>m.id==='manual-ranked-1'));
 assert.match(await page.locator('#scope').innerText(),/Mayhem/);assert.doesNotMatch(await page.locator('#scope').innerText(),/21 Mayhem/);
 // Imported notes are literal text, not markup; the input was not relabelled as live Riot.
 assert.match(await page.locator('#source-banner').innerText(),/not been reverified/);
 await page.locator('#limit-filter').selectOption('500');
 assert.equal(await page.locator('.match-notes b').count(),0);
 for(const width of [1440,768,390,360]){
  await page.setViewportSize({width,height:900});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`horizontal overflow at ${width}`);
  assert.equal(await page.locator('[data-language=en]').isVisible(),true);
 }
 await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:'/tmp/rift-mayhem-mobile.png',fullPage:false});
 await page.setViewportSize({width:1440,height:1000});await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:'/tmp/rift-mayhem-desktop.png',fullPage:false});
 await page.locator('#clear-device').click();assert.equal(await page.evaluate(()=>localStorage.getItem('rift-review-history-v1')),null);assert.ok(await page.locator('.match-row').count()>0);
 // Sample data and storage-denied browsing never claim a saved history.
 const blocked=await browser.newContext();await blocked.addInitScript(()=>Object.defineProperty(window,'localStorage',{get(){throw new DOMException('blocked','SecurityError');}}));
 const denied=await blocked.newPage();denied.on('pageerror',e=>errors.push(e.message));await denied.goto(origin);await denied.waitForSelector('.match-row');
 await denied.locator('#sample-choice').selectOption('mayhem');await denied.locator('#load-sample').click();assert.match(await denied.locator('#source-banner').innerText(),/giả lập/);
 await denied.locator('#riot-lookup [name=riotId]').fill('Mayhem#TEST');await denied.locator('#lookup-mode').selectOption('mayhem');await denied.locator('#riot-lookup [name=count]').selectOption('10');
 await denied.locator('#lookup-button').click();await denied.waitForFunction(()=>document.querySelector('#storage-status').textContent.includes('Không lưu được'));
 assert.equal(await denied.locator('.match-row').count(),10);
 assert.ok(upstream.some(url=>url.searchParams.get('queue')==='2400'&&url.searchParams.get('start')==='10'));
 assert.deepEqual(errors,[]);
 console.log('PASS: browser → local API → mocked Riot queue2400; pagination/dedup, persistence, manual/import refresh, failure preservation, VI/EN, mobile, blocked storage. Synthetic data only.');
}finally{await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
