import test from 'node:test';
import assert from 'node:assert/strict';
import {setLanguage} from '../public/i18n.js';
import {renderMatchSummary,renderLoadout} from '../public/match-view.js';
import {sampleMatchDetail} from '../public/sample-loadouts.js';
import {LiveDataError} from '../public/riot-source.js';

test('English match cards and loadouts translate labels and item names without changing IDs',()=>{
  setLanguage('en');
  try{
    const match={id:'OC1_123',champion:'Ahri',role:'Mid',queue:'Ranked Solo',result:'Victory',durationMinutes:31+5/60,kills:8,deaths:3,assists:9};
    const detail=sampleMatchDetail(match);
    const html=renderMatchSummary({match,detail,source:'riot'});
    const loadout=renderLoadout(detail.participants.find(p=>p.isPlayer));
    assert.ok(html.includes('VICTORY'));
    assert.ok(html.includes('View lobby rank'));
    assert.ok(html.includes('31m05s'));
    assert.ok(html.includes('Ahri'));
    assert.ok(loadout.includes('Rune page'));
    assert.ok(loadout.includes('Primary path'));
    assert.ok(loadout.includes('Secondary path'));
    assert.ok(loadout.includes('Stat shards'));
    assert.ok(loadout.includes('Flash'));
    assert.ok(loadout.includes('/items/3020.png'));
    assert.ok(!loadout.includes('Ngọc chính'));
  }finally{setLanguage('vi');}
});
test('API errors translate through stable error codes and retain retry values',()=>{
  setLanguage('en');
  try{
    const error=new LiveDataError('Riot đang giới hạn yêu cầu.','RIOT_RATE_LIMIT',30);
    assert.match(error.messages[0],/rate limit/i);
    assert.equal(error.retryAfter,30);
    assert.ok(!new LiveDataError('lỗi bất kỳ','UNKNOWN_CODE').messages[0].includes('lỗi bất kỳ'));
  }finally{setLanguage('vi');}
  assert.ok(new LiveDataError('Riot đang giới hạn yêu cầu.','RIOT_RATE_LIMIT',30).messages[0].includes('Riot'));
});
