import test from 'node:test';
import assert from 'node:assert/strict';
import {sampleHistory, normalizeHistory} from '../public/history-data.js';
import {analyzeHistory} from '../public/history-coach.js';
import {setLanguage} from '../public/i18n.js';
import {
  buildChartData,
  chartGeometry,
  chartMetrics,
  renderStatsCharts,
  chartPointText,
} from '../public/stats-charts.js';

const reportOf = matches => analyzeHistory(normalizeHistory({matches}), {limit: 500});
test('charts use all filtered matches, oldest first, and preserve the report', () => {
  const history = sampleHistory();
  const report = analyzeHistory(history, {champion: 'Ahri', limit: 20});
  const before = JSON.stringify(report);
  const data = buildChartData(report, 'cs');
  assert.equal(data.points.length, report.stats.n);
  assert.ok(data.points.length > 10, 'chart must not be limited to the visible page');
  assert.ok(data.points.every(p => p.match.champion === 'Ahri'));
  assert.equal(data.points[0].match.id, report.matches.at(-1).id);
  assert.equal(JSON.stringify(report), before);
});

test('unknown values, legitimate zero and deathless KDA are distinct', () => {
  const base = sampleHistory().matches[0];
  const report = reportOf([
    {
      ...base,
      id: 'a',
      playedAt: null,
      cs: 0,
      teamKills: null,
      deaths: 0,
      kills: 4,
      assists: 2,
      damageToChampions: null,
    },
    {
      ...base,
      id: 'b',
      playedAt: null,
      cs: null,
      deaths: 4,
      kills: 6,
      assists: 2,
      durationMinutes: 20,
      damageToChampions: 10000,
    },
  ]);
  assert.deepEqual(
    buildChartData(report, 'cs').points.map(p => p.value),
    [null, 0],
  );
  assert.deepEqual(
    buildChartData(report, 'damage').points.map(p => p.value),
    [500, null],
  );
  assert.equal(buildChartData(report, 'kp').points[1].value, null);
  const kda = buildChartData(report, 'kda');
  assert.equal(kda.points[0].value, 2);
  assert.equal(kda.points[1].value, null);
  assert.equal(kda.points[1].perfect, true);
  assert.match(chartPointText(kda.points[1], kda.metric), /Không chết/);
  assert.match(renderStatsCharts(report, 'cs'), /Có trận thiếu ngày/);
});

test('line breaks at missing data and handles single and zero-valued points', () => {
  const geometry = chartGeometry([{value: 0}, {value: null}, {value: 4}], 4);
  assert.equal((geometry.path.match(/M/g) || []).length, 2);
  assert.equal(geometry.path.includes('L'), false);
  assert.equal(geometry.positions[1].y, null);
  assert.deepEqual(chartGeometry([{value: 0}], 1).positions[0], {x: 416, y: 200});
  assert.doesNotMatch(geometry.path, /NaN|Infinity/);
});

test('Mayhem charts exclude remakes, separate SR and use descriptive metrics only', () => {
  const sr = sampleHistory().matches[0];
  const mayhem = sampleHistory('mayhem').matches;
  const history = normalizeHistory({matches: [sr, ...mayhem.map((m, i) => ({...m, isRemake: i === 0}))]});
  const report = analyzeHistory(history, {queue: 'ARAM Mayhem', limit: 500});
  const data = buildChartData(report, 'vision');
  assert.equal(data.metric.id, 'damage');
  assert.equal(data.points.length, mayhem.length - 1);
  assert.ok(data.points.every(p => p.match.queue === 'ARAM Mayhem' && !p.match.isRemake));
  assert.equal(
    data.champions.reduce((n, c) => n + c.games, 0),
    report.stats.n,
  );
  assert.ok(chartMetrics('mayhem').every(metric => metric.id !== 'vision'));
});

test('champion rates retain sample sizes and chart render handles empty, missing and unsafe labels', () => {
  const base = sampleHistory().matches[0];
  const report = reportOf([
    {...base, id: 'a', champion: '<img src=x>', result: 'Victory', goldEarned: null},
    {...base, id: 'b', champion: '<img src=x>', result: 'Defeat', goldEarned: null},
  ]);
  const data = buildChartData(report, 'gold');
  assert.deepEqual(data.champions[0], {champion: '<img src=x>', games: 2, wins: 1});
  const html = renderStatsCharts(report, 'gold');
  assert.match(html, /50%/);
  assert.match(html, /Chưa có giá trị số/);
  assert.doesNotMatch(html, /<img src=x>/);
  assert.match(html, /&lt;img src=x&gt;/);
  assert.doesNotMatch(html, /NaN|Infinity/);
  const empty = analyzeHistory(sampleHistory(), {champion: 'Not in sample'});
  assert.match(renderStatsCharts(empty, 'cs'), /Chưa có trận hợp lệ/);
});

test('chart controls and data table translate to English', () => {
  try {
    setLanguage('en');
    const html = renderStatsCharts(analyzeHistory(sampleHistory()), 'damage');
    assert.match(html, /Statistics charts/);
    assert.match(html, /View chart data table/);
    assert.match(html, /Damage \/ min/);
    assert.doesNotMatch(html, /[à-ỹÀ-Ỹ]/);
  } finally {
    setLanguage('vi');
  }
});
