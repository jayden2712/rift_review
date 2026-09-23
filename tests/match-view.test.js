import test from 'node:test';
import assert from 'node:assert/strict';
import {formatDuration, renderMatchSummary, renderRunePage, renderItemSlots} from '../public/match-view.js';

const match={id:'OC1_123',champion:'Ahri',role:'Mid',queue:'Ranked Solo',result:'Victory',durationMinutes:31+5/60,kills:8,deaths:5,assists:12,cs:226,visionScore:22};
const metrics={kda:4,csPerMin:7.3,participation:.67};

test('duration uses seconds with padding and correct rollover',()=>{
  for(const [minutes,expected] of [[0,'00m00s'],[5,'05m00s'],[31+5/60,'31m05s'],[30.999,'31m00s'],[90,'90m00s']]) assert.equal(formatDuration(minutes),expected);
  for(const value of [null,undefined,-1,NaN,Infinity,'31']) assert.equal(formatDuration(value),'—');
  assert.equal(formatDuration(30,1865),'31m05s');
});

test('match summary keeps imported data honest and escapes external text',()=>{
  const html=renderMatchSummary({match:{...match,champion:'<img onerror=alert(1)>',id:'"><script>'},metrics,source:'json',dateLabel:'<bad>'});
  assert.ok(html.includes('31m05s'));
  assert.ok(html.includes('Chưa có dữ liệu'));
  assert.ok(!html.includes('data-load-rank'));
  assert.ok(html.includes('&lt;bad&gt;'));
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('<img onerror'));
});

test('summary displays loadout and current rank with visible coverage without historical claims',()=>{
  const participant={isPlayer:true,champion:'Ahri',championLevel:16,summonerSpells:[4,14],items:[3020,0,null,3089,3135,3157,3363],runes:{primaryStyle:8100,secondaryStyle:8200,primary:[8112,8126,8138,8106],secondary:[8226,8210],shards:[5008,5008,5002]}};
  const html=renderMatchSummary({match,metrics,detail:{participants:[participant]},source:'riot',dateLabel:'24/9/2026',rankState:{lobbyRank:{status:'partial',label:'GOLD II',tier:'GOLD',rankedCount:8,totalPlayers:10,basis:'current'}}});
  assert.ok(html.includes('GOLD II'));
  assert.ok(html.includes('8/10'));
  assert.ok(html.includes('hiện tại'));
  assert.equal((html.match(/class="equipment-slot/g)||[]).length,7);
  assert.ok(html.includes('/spells/4.png'));
  assert.ok(html.includes('Cấp 16'));
  assert.ok(html.includes('Chưa có dữ liệu'));
});

test('rune page includes both paths and all three stat shards, with bounded unknown values',()=>{
  const html=renderRunePage({runes:{primaryStyle:8100,secondaryStyle:8200,primary:[8112,8126,8138,8106,99999],secondary:[8226,8210],shards:[5008,5008,5002]}});
  assert.ok(html.includes('Ngọc chính'));
  assert.ok(html.includes('Ngọc phụ'));
  assert.ok(html.includes('Mảnh chỉ số'));
  assert.ok(!html.includes('99999'));
  assert.ok(renderRunePage(null).includes('Chưa có dữ liệu'));
  assert.equal((renderItemSlots({items:Array(50).fill(0)}).match(/class="equipment-slot/g)||[]).length,7);
});

test('rank loading and errors remain separate from history and normal queues have no rank lookup',()=>{
  assert.ok(renderMatchSummary({match,metrics,source:'riot',rankState:{loading:true}}).includes('Đang tải rank'));
  const html=renderMatchSummary({match,metrics,source:'riot',rankState:{error:'<not safe>'}});
  assert.ok(html.includes('&lt;not safe&gt;'));
  assert.ok(html.includes('data-load-rank'));
  assert.ok(!renderMatchSummary({match:{...match,queue:'Normal'},metrics,source:'riot'}).includes('data-load-rank'));
});
