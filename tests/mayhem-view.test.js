import test from 'node:test';
import assert from 'node:assert/strict';
import {setLanguage} from '../public/i18n.js';
import {renderMatchSummary,renderLoadout,renderLobbyRank} from '../public/match-view.js';

const match={id:'OC1_123',champion:'Ahri',queue:'ARAM Mayhem',role:null,result:'Victory',isRemake:false,durationMinutes:20,kills:8,deaths:4,assists:12,damageToChampions:30000};
const metrics={kda:5,participation:.8,csPerMin:99};
const rankState={lobbyRank:{status:'available',tier:'CHALLENGER',label:'Challenger',rankedCount:10,totalPlayers:10}};

test('Mayhem summary shows damage and KP with no SR rank, CS or vision',()=>{
  setLanguage('vi');
  const html=renderMatchSummary({match,metrics,rankState,source:'riot',detail:{durationSeconds:1205}});
  assert.match(html,/ARAM Mayhem/);
  assert.match(html,/20m05s/);
  assert.match(html,/Không áp dụng/);
  assert.match(html,/Sát thương/);
  assert.match(html,/30\.000/);
  assert.match(html,/80%/);
  assert.doesNotMatch(html,/Challenger|MMR|rank|CS|Vision|99\.0/);
  assert.equal(renderLobbyRank(match,rankState,'riot'),'');
});

test('Mayhem summary distinguishes unavailable damage from actual zero and marks remakes',()=>{
  const absent=renderMatchSummary({match:{...match,damageToChampions:null},metrics});
  const zero=renderMatchSummary({match:{...match,damageToChampions:0},metrics});
  assert.match(absent,/Sát thương —/);
  assert.match(zero,/Sát thương 0/);
  assert.match(renderMatchSummary({match:{...match,isRemake:true},metrics}),/ĐẤU LẠI/);
});

test('Mayhem loadout exposes items and spells but no fabricated runes or augments',()=>{
  const html=renderLoadout({items:[3020],summonerSpells:[4,32],runes:{primary:[],secondary:[],shards:[]},augments:null},{mayhem:true});
  assert.match(html,/\/items\/3020.png/);
  assert.match(html,/Phép bổ trợ/);
  assert.match(html,/Chưa có dữ liệu ngọc cho trận này/);
  assert.match(html,/Augments/);
  assert.match(html,/Chưa xác minh dữ liệu nâng cấp cho trận này/);
  assert.doesNotMatch(html,/rune-selection|Ngọc chính|Ngọc phụ/);
  const actual=renderLoadout({runes:{primaryStyle:8000,primary:[8005]}},{mayhem:true});
  assert.match(actual,/rune-selection/);
});

test('Mayhem rendering escapes external text and does not trust unverified augment objects',()=>{
  const attack='<img src=x onerror=alert(1)>';
  const html=renderMatchSummary({match:{...match,champion:attack},dateLabel:attack,detail:{participants:[{champion:'Ahri',riotId:attack,teamId:100} ]}});
  assert.doesNotMatch(html,/<img src=x/);
  assert.match(html,/&lt;img src=x/);
  assert.doesNotMatch(renderLoadout({augments:[{name:attack}]},{mayhem:true}),/onerror/);
});

test('Mayhem English labels describe unavailable data without rank or coaching claims',()=>{
  setLanguage('en');
  try{
    const html=renderMatchSummary({match:{...match,isRemake:true},metrics,rankState,source:'riot'});
    const loadout=renderLoadout(null,{mayhem:true});
    assert.match(html,/REMAKE/);
    assert.match(html,/Damage 30,000/);
    assert.match(html,/Not applicable/);
    assert.match(loadout,/Augment data has not been verified for this match/);
    assert.match(loadout,/Rune data is unavailable for this match/);
    assert.doesNotMatch(html+loadout,/Challenger|MMR|rank-load|optimal|recommended/i);
  }finally{setLanguage('vi');}
});
