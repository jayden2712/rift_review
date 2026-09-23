import test from 'node:test';
import assert from 'node:assert/strict';
import {setLanguage} from '../public/i18n.js';
import {sampleHistory, normalizeHistory, historyJsonSource} from '../public/history-data.js';
import {analyzeHistory, historyReportToMarkdown} from '../public/history-coach.js';
import {normalizeMatch, SAMPLES} from '../public/data.js';

test('changing language recomputes history coaching and exports without changing the data',()=>{
  const history=sampleHistory();
  const original=JSON.stringify(history);
  try {
    setLanguage('vi');
    const vietnamese=analyzeHistory(history);
    assert.match(vietnamese.findings[0].title,/[à-ỹ]/);
    setLanguage('en');
    const english=analyzeHistory(history);
    assert.equal(english.engine,'Coaching rules v2');
    assert.equal(english.findings.find(f=>f.id==='survival').title,'Reduce avoidable deaths');
    assert.deepEqual(english.stats,vietnamese.stats);
    assert.deepEqual(english.findings.map(f=>f.matchIds),vietnamese.findings.map(f=>f.matchIds));
    const markdown=historyReportToMarkdown(english);
    assert.match(markdown,/## Strengths/);
    assert.match(markdown,/Filters:/);
    assert.doesNotMatch(markdown,/[à-ỹÀ-Ỹ]/);
    assert.equal(JSON.stringify(history),original);
    setLanguage('vi');
    assert.equal(analyzeHistory(history).findings[0].title,vietnamese.findings[0].title);
  } finally {setLanguage('vi');}
});

test('validation localizes descriptions while preserving supplied names and stable enum values',async()=>{
  try {
    setLanguage('en');
    assert.throws(()=>normalizeHistory({matches:[]}),/History requires between 1 and 500 games/);
    assert.throws(()=>normalizeMatch({...SAMPLES.learning,kills:-1}),/Kills must be a whole number from 0 to 100/);
    await assert.rejects(historyJsonSource.load('{bad}'),/Invalid JSON/);
    const history=normalizeHistory({profile:{riotId:'Tên của tôi#VN'},matches:[SAMPLES.learning]});
    assert.equal(history.profile.riotId,'Tên của tôi#VN');
    assert.equal(history.matches[0].role,'Mid');
    setLanguage('vi');
    assert.throws(()=>normalizeMatch({...SAMPLES.learning,kills:-1}),/Hạ gục cần là số nguyên từ 0 đến 100/);
  } finally {setLanguage('vi');}
});

test('an existing validation error updates language without revalidating or changing user data',()=>{
  let error;
  try {
    setLanguage('vi');
    try {normalizeHistory({matches:[{...SAMPLES.learning,kills:-1}]});}catch(caught){error=caught;}
    assert.ok(error);
    assert.match(error.messages[0],/Trận 1: Hạ gục cần là số nguyên từ 0 đến 100/);
    setLanguage('en');
    assert.match(error.messages[0],/Game 1: Kills must be a whole number from 0 to 100/);
    setLanguage('vi');
    assert.match(error.messages[0],/Trận 1: Hạ gục/);
  } finally {setLanguage('vi');}
});
