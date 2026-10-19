import test from 'node:test';
import assert from 'node:assert/strict';
import {setLanguage} from '../public/i18n.js';
import {
  renderLabTimeline,
  renderTimelineChart,
  renderLabCollection,
} from '../public/data-lab-timeline-view.js';
const record = {
  matchId: 'OC1_100',
  source: 'riot',
  normalized: {mapId: 11, queueId: 420},
  timeline: {
    status: 'loaded',
    collectedAt: '2026-10-05T00:00:00Z',
    raw: {unsafe: '<script>alert(1)</script>'},
    normalized: {
      participantId: 3,
      frames: [
        {timestamp: 0, cs: 0, totalGold: 500},
        {timestamp: 90000, cs: null, totalGold: null},
        {timestamp: 180000, cs: 12, totalGold: 1200},
      ],
      checkpoints: [
        {
          targetTimestamp: 600000,
          actualTimestamp: 570000,
          offsetMs: -30000,
          cs: 70,
          totalGold: 3500,
          xp: null,
        },
        {
          targetTimestamp: 900000,
          actualTimestamp: null,
          reason: 'ended_before_target',
          cs: null,
          totalGold: null,
          xp: null,
        },
      ],
      events: [
        {id: 'a', timestamp: 120000, type: 'CHAMPION_KILL', playerRelated: true, playerRole: 'death'},
        {id: 'b', timestamp: 120000, type: 'ITEM_PURCHASED', playerRelated: true, itemId: 1001},
        {id: 'c', timestamp: 150000, type: 'ELITE_MONSTER_KILL', playerRelated: false, monsterType: 'DRAGON'},
      ],
    },
  },
};
test('timeline displays real sample time, offset, missing reason and escaped raw', () => {
  setLanguage('en');
  const html = renderLabTimeline(record);
  assert.match(html, /09m30s/);
  assert.match(html, /-30/);
  assert.match(html, /Ended before target/);
  assert.match(html, /&lt;script&gt;/);
  assert.ok(!html.includes('<script>'));
  assert.match(html, /Raw timeline JSON/);
  assert.match(html, /participantId: 3/);
});
test('player event filtering retains distinct events at one timestamp', () => {
  setLanguage('en');
  const filtered = renderLabTimeline(record, {playerOnly: true}),
    all = renderLabTimeline(record, {playerOnly: false});
  assert.match(filtered, /CHAMPION_KILL/);
  assert.match(filtered, /ITEM_PURCHASED/);
  assert.ok(!filtered.includes('ELITE_MONSTER_KILL'));
  assert.match(all, /ELITE_MONSTER_KILL/);
});
test('charts use actual time and break line across missing values', () => {
  const chart = renderTimelineChart(record.timeline.normalized.frames, 'cs', 'CS');
  assert.ok(!chart.includes('polyline'));
  assert.equal((chart.match(/<circle/g) || []).length, 2);
  assert.match(chart, /03m00s/);
  const uneven = renderTimelineChart(
    [
      {timestamp: 0, cs: 0},
      {timestamp: 30000, cs: 1},
      {timestamp: 180000, cs: 2},
    ],
    'cs',
    'CS',
  );
  assert.match(uneven, /L 120\.00/);
});
test('failed retry keeps charts and raw available with retry status', () => {
  setLanguage('vi');
  const html = renderLabTimeline({
    ...record,
    timeline: {
      ...record.timeline,
      status: 'error',
      lastError: {code: 'RIOT_FORBIDDEN', status: 403, message: '<bad>'},
    },
  });
  assert.match(html, /Thử lại/);
  assert.match(html, /403/);
  assert.match(html, /lab-timeline-chart/);
  assert.match(html, /JSON timeline nguyên bản/);
  assert.ok(!html.includes('<bad>'));
});
test('unloaded SR permits one request; non SR is explicitly unsupported', () => {
  setLanguage('en');
  assert.match(renderLabTimeline({...record, timeline: undefined}), /data-lab-timeline="OC1_100"/);
  assert.ok(
    !renderLabTimeline({...record, normalized: {mapId: 12, queueId: 450}, timeline: undefined}).includes(
      'data-lab-timeline=',
    ),
  );
});
test('collection summary distinguishes counts and only retries eligible failures', () => {
  setLanguage('en');
  const html = renderLabCollection({
    requested: 10,
    succeeded: 2,
    failed: 1,
    notAttempted: 7,
    coachingEligible: 1,
    failures: [{matchId: 'OC1_12', code: 'TIMEOUT', retryable: true}],
  });
  assert.match(html, /Requested: 10/);
  assert.match(html, /Not attempted: 7/);
  assert.match(html, /OC1_12/);
  assert.match(html, /data-lab-retry/);
  assert.ok(
    !renderLabCollection({failures: [{matchId: 'x', code: '403', retryable: false}]}).includes(
      'data-lab-retry',
    ),
  );
  setLanguage('vi');
});
test('subsecond samples remain distinguishable and unattempted matches are retryable', () => {
  setLanguage('en');
  const html = renderLabTimeline({
    ...record,
    timeline: {
      ...record.timeline,
      normalized: {
        ...record.timeline.normalized,
        checkpoints: [
          {targetTimestamp: 600000, actualTimestamp: 599999, offsetMs: -1, cs: 0, totalGold: 0, xp: 0},
        ],
      },
    },
  });
  assert.match(html, /09m59\.999s/);
  assert.match(html, /-0\.001s/);
  assert.match(renderLabCollection({notAttemptedIds: ['OC1_12']}), /data-lab-retry/);
  assert.ok(
    !renderLabCollection({notAttemptedIds: ['OC1_12']}, {canRetry: false}).includes('data-lab-retry'),
  );
  setLanguage('vi');
});
test('client failures without response snapshots record safe errors while preserving valid timeline', async () => {
  const {preserveTimelineFailure} = await import('../public/data-lab.js');
  const {createLabSnapshot, attachLabTimeline} = await import('../public/data-lab-model.js');
  const {matchFixture, timelineFixture} = await import('./fixtures/lab-timeline.js');
  const loaded = attachLabTimeline(
    createLabSnapshot({rawMatches: [matchFixture()], playerPuuid: 'player'}, {source: 'riot'}),
    'OC1_99',
    timelineFixture(),
  );
  for (const failure of [
    new TypeError('fetch failed with private request details'),
    Object.assign(new Error('bad JSON'), {status: 504}),
    Object.assign(new Error('too big'), {status: 413, code: 'UNTRUSTED_CODE'}),
  ]) {
    const updated = preserveTimelineFailure(loaded, 'OC1_99', failure, '2026-10-05T01:02:03.000Z');
    const timeline = updated.records[0].timeline;
    assert.equal(timeline.status, 'error');
    assert.equal(timeline.lastAttemptAt, '2026-10-05T01:02:03.000Z');
    assert.equal(timeline.lastError.code, 'TIMELINE_ERROR');
    assert.deepEqual(timeline.raw, loaded.records[0].timeline.raw);
    assert.equal(timeline.lastError.message, 'Timeline request failed.');
    assert.equal(loaded.records[0].timeline.status, 'loaded');
  }
});
