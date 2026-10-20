import test from 'node:test';
import assert from 'node:assert/strict';
import {matchMetrics, compareHistory} from '../public/comparison.js';

const ROLES = ['Top', 'Jungle', 'Mid', 'ADC', 'Support'];
// Ten players; the player is Mid on team 100. `you` and `opp` patch the two mid laners.
function game(id, {result = 'Victory', minutes = 30, you = {}, opp = {}, role = 'Mid'} = {}) {
  const base = {
    kills: 3,
    deaths: 4,
    assists: 6,
    cs: 180,
    goldEarned: 10000,
    damageToChampions: 15000,
    visionScore: 20,
  };
  const participants = [100, 200].flatMap(teamId =>
    ROLES.map(r => ({
      ...base,
      teamId,
      role: r,
      isPlayer: teamId === 100 && r === role,
      ...(teamId === 100 && r === role ? you : {}),
      ...(teamId === 200 && r === role ? opp : {}),
    })),
  );
  const player = participants.find(p => p.isPlayer);
  const match = {
    id,
    result,
    role,
    queue: 'Ranked Solo',
    durationMinutes: minutes,
    kills: player.kills,
    deaths: player.deaths,
    assists: player.assists,
    cs: player.cs,
    visionScore: player.visionScore,
    teamKills: participants.filter(p => p.teamId === 100).reduce((t, p) => t + p.kills, 0),
    damageToChampions: player.damageToChampions,
    goldEarned: player.goldEarned,
  };
  return {match, detail: {durationSeconds: minutes * 60, participants}};
}
const build = games => ({
  matches: games.map(g => g.match),
  details: Object.fromEntries(games.map(g => [g.match.id, g.detail])),
});

test('match metrics compare the player with the opposing laner and the team', () => {
  const {match, detail} = game('m', {you: {cs: 240, damageToChampions: 30000, deaths: 2}, opp: {cs: 180}});
  const m = matchMetrics(match, detail);
  assert.equal(m.you.csPerMin, 8);
  assert.equal(m.opponent.csPerMin, 6);
  assert.equal(m.you.deathsPer30, 2);
  // Team damage: 4 × 15,000 + 30,000.
  assert.equal(m.you.damageShare, 30000 / 90000);
  assert.equal(m.you.kp, (3 + 6) / 15);
  assert.equal(matchMetrics(match, null).opponent, null);
  const noOpponent = {
    ...detail,
    participants: detail.participants.filter(p => !(p.teamId === 200 && p.role === 'Mid')),
  };
  assert.equal(matchMetrics(match, noOpponent).opponent, null);
});

test('lane comparison counts how often you are ahead of your opponent per metric', () => {
  const games = Array.from({length: 6}, (_, i) =>
    game(`m${i}`, {you: {cs: 150, deaths: 2}, opp: {cs: i < 5 ? 210 : 120, deaths: 6}}),
  );
  const {lane} = compareHistory(build(games));
  const cs = lane.metrics.find(x => x.id === 'csPerMin');
  assert.equal(cs.total, 6);
  assert.equal(cs.ahead, 1);
  assert.equal(cs.behind, 5);
  assert.equal(cs.consistentlyBehind, true);
  const deaths = lane.metrics.find(x => x.id === 'deathsPer30');
  assert.equal(deaths.ahead, 6);
  assert.equal(deaths.consistentlyAhead, true);
  assert.equal(lane.matches, 6);
});

test('wins and losses are contrasted only with enough of each, strongest difference first', () => {
  const wins = Array.from({length: 5}, (_, i) => game(`w${i}`, {you: {deaths: 2 + (i % 2)}}));
  const losses = Array.from({length: 5}, (_, i) =>
    game(`l${i}`, {result: 'Defeat', you: {deaths: 7 + (i % 2), cs: 180 + i}}),
  );
  const {winLoss} = compareHistory(build([...wins, ...losses]));
  assert.equal(winLoss.available, true);
  assert.deepEqual([winLoss.wins, winLoss.losses], [5, 5]);
  assert.equal(winLoss.metrics[0].id, 'deathsPer30');
  assert.ok(winLoss.metrics[0].win < winLoss.metrics[0].loss);
  assert.equal(winLoss.metrics[0].favorsWins, true);
  assert.equal(winLoss.metrics[0].notable, true);
  assert.equal(winLoss.metrics.find(x => x.id === 'goldPerMin').notable, false);
  const few = compareHistory(build([...wins, losses[0]])).winLoss;
  assert.equal(few.available, false);
  const thin = compareHistory(build([...wins, ...losses.slice(0, 3)])).winLoss;
  assert.equal(thin.available, true);
  assert.equal(thin.metrics[0].notable, false, 'three losses are too few to call out');
});

test('self comparison sets the last five games of the main role against your earlier median', () => {
  const recent = Array.from({length: 5}, (_, i) => game(`r${i}`, {you: {deaths: 8}}));
  const earlier = Array.from({length: 6}, (_, i) => game(`e${i}`, {you: {deaths: 3}}));
  const offRole = game('t0', {role: 'Top', you: {deaths: 0}});
  const {self} = compareHistory(build([...recent, offRole, ...earlier]));
  assert.equal(self.available, true);
  assert.equal(self.role, 'Mid');
  assert.deepEqual([self.recentN, self.baselineN], [5, 6]);
  const deaths = self.metrics.find(x => x.id === 'deathsPer30');
  assert.equal(deaths.recent, 8);
  assert.equal(deaths.typical, 3);
  assert.equal(deaths.better, false);
  assert.equal(deaths.notable, true);
  assert.equal(self.metrics.find(x => x.id === 'goldPerMin').notable, false);
  assert.equal(compareHistory(build(recent)).self.available, false);
});

test('supports skip CS, and matches without details are counted as uncovered', () => {
  const support = game('s', {role: 'Support'});
  const bare = game('b').match;
  const result = compareHistory({matches: [support.match, bare], details: {s: support.detail}});
  assert.deepEqual(result.coverage, {withDetail: 1, total: 2});
  assert.equal(result.lane.metrics.find(x => x.id === 'csPerMin').total, 0);
});

test('champion breakdown summarises champions with at least three games against their lane opponents', async () => {
  const {championBreakdown} = await import('../public/comparison.js');
  const pick = (id, champion, result, you, opp) => {
    const g = game(id, {result, you, opp});
    g.match.champion = champion;
    return g;
  };
  const games = [
    pick('a1', 'Ahri', 'Victory', {cs: 240}, {cs: 180}),
    pick('a2', 'Ahri', 'Victory', {cs: 240}, {cs: 180}),
    pick('a3', 'Ahri', 'Defeat', {cs: 210}, {cs: 180}),
    pick('z1', 'Zed', 'Defeat', {cs: 150}, {cs: 210}),
    pick('z2', 'Zed', 'Defeat', {cs: 150}, {cs: 210}),
    pick('z3', 'Zed', 'Victory', {cs: 150}, {cs: 210}),
    pick('l1', 'Lux', 'Victory', {}, {}),
  ];
  const rows = championBreakdown(build(games));
  assert.deepEqual(
    rows.map(r => r.champion),
    ['Ahri', 'Zed'],
  );
  const ahri = rows[0];
  assert.equal(ahri.games, 3);
  assert.equal(ahri.wins, 2);
  assert.equal(ahri.csPerMin, 23 / 3);
  assert.ok(Math.abs(ahri.csDiffPerMin - (23 / 3 - 6)) < 1e-9);
  assert.ok(rows[1].csDiffPerMin < 0);
  assert.equal(rows[1].laneGames, 3);
});
