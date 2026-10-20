import test from 'node:test';
import assert from 'node:assert/strict';
import {mapRiotMatch} from '../server/riot.js';
import {normalizeHistory, exportHistory} from '../public/history-data.js';
import {InputError} from '../public/data.js';
import {matchMetrics, compareHistory} from '../public/comparison.js';

const puuid = 'fixture-player';
const POSITIONS = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'];
function rawMatch(patchPlayer = {}) {
  const participants = Array.from({length: 10}, (_, i) => ({
    puuid: i === 2 ? puuid : `fixture-${i}`,
    teamId: i < 5 ? 100 : 200,
    championName: 'Ahri',
    teamPosition: POSITIONS[i % 5],
    win: i < 5,
    kills: 4,
    deaths: 3,
    assists: 5,
    totalMinionsKilled: 170,
    neutralMinionsKilled: 10,
    visionScore: 22,
    totalDamageDealtToChampions: 21000,
    goldEarned: 12500,
    totalTimeSpentDead: 90,
    challenges: {
      laneMinionsFirst10Minutes: i === 7 ? 80 : 62,
      jungleCsBefore10Minutes: 60.25,
      controlWardsPlaced: 3,
      wardTakedowns: 4,
      turretPlatesTaken: 2,
      dragonTakedowns: 1,
      baronTakedowns: 0,
      riftHeraldTakedowns: 1,
      enemyJungleMonsterKills: 5,
      soloKills: 1,
      unrelatedChallenge: 999,
    },
    ...(i === 2 ? patchPlayer : {}),
  }));
  return {
    metadata: {matchId: 'OC1_123'},
    info: {participants, mapId: 11, queueId: 420, gameDuration: 1800, gameStartTimestamp: 1789380000000},
  };
}

test('Riot mapping keeps a whitelist of challenge metrics for every participant', () => {
  const {detail} = mapRiotMatch(rawMatch(), puuid, 'OC1_123');
  const self = detail.participants.find(p => p.isPlayer);
  assert.deepEqual(self.extra, {
    laneCs10: 62,
    jungleCs10: 60.25,
    controlWards: 3,
    wardTakedowns: 4,
    plates: 2,
    dragons: 1,
    barons: 0,
    heralds: 1,
    enemyJungleCamps: 5,
    soloKills: 1,
    timeDead: 90,
  });
  assert.ok(detail.participants.every(p => p.extra && !('unrelatedChallenge' in p.extra)));
  const missing = mapRiotMatch(
    rawMatch({challenges: undefined, totalTimeSpentDead: undefined}),
    puuid,
    'OC1_123',
  );
  assert.equal(missing.detail.participants.find(p => p.isPlayer).extra, null);
});

test('History v3 validates and round-trips challenge metrics', () => {
  const {match, detail} = mapRiotMatch(rawMatch(), puuid, 'OC1_123');
  const history = normalizeHistory({schemaVersion: 3, matches: [match], details: {[match.id]: detail}});
  assert.equal(history.details[match.id].participants.find(p => p.isPlayer).extra.laneCs10, 62);
  assert.deepEqual(normalizeHistory(exportHistory(history)), history);
  for (const extra of [{laneCs10: -1}, {laneCs10: 'x'}, {laneCs10: Infinity}, {bogus: 1}, 'x']) {
    const bad = {...detail, participants: detail.participants.map(p => (p.isPlayer ? {...p, extra} : p))};
    assert.throws(
      () => normalizeHistory({matches: [match], details: {[match.id]: bad}}),
      InputError,
      JSON.stringify(extra),
    );
  }
});

test('comparisons add role-specific metrics from challenges', () => {
  const {match, detail} = mapRiotMatch(rawMatch(), puuid, 'OC1_123');
  const m = matchMetrics(match, detail);
  assert.equal(m.you.csAt10, 62);
  assert.equal(m.opponent.csAt10, 80);
  assert.equal(m.you.timeDeadShare, 90 / 1800);
  assert.equal(m.you.controlWardsPer30, 3);
  assert.equal(m.you.objectives, 2);
  const {lane} = compareHistory({matches: [match], details: {[match.id]: detail}});
  const ids = lane.metrics.filter(x => x.total).map(x => x.id);
  assert.ok(ids.includes('csAt10'));
  assert.ok(ids.includes('plates'));
  assert.ok(!ids.includes('jungleCsAt10'), 'jungle metrics do not apply to Mid');
  assert.ok(!ids.includes('enemyJungleCamps'));
});

test('jungle and support players get their own metrics', () => {
  const jungle = rawMatch({teamPosition: 'JUNGLE'});
  jungle.info.participants[1].teamPosition = 'MIDDLE';
  const {match, detail} = mapRiotMatch(jungle, puuid, 'OC1_123');
  const ids = compareHistory({matches: [match], details: {[match.id]: detail}})
    .lane.metrics.filter(x => x.total)
    .map(x => x.id);
  assert.ok(ids.includes('jungleCsAt10'));
  assert.ok(ids.includes('enemyJungleCamps'));
  assert.ok(!ids.includes('csAt10'));
  assert.ok(!ids.includes('csPerMin') || match.role === 'Jungle');
});
