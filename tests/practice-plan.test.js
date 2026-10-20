import test from 'node:test';
import assert from 'node:assert/strict';
import {
  choosePlanFocus,
  createPlan,
  evaluatePlan,
  loadPlan,
  savePlan,
  clearPlan,
} from '../public/practice-plan.js';

const ROLES = ['Top', 'Jungle', 'Mid', 'ADC', 'Support'];
function game(id, {result = 'Victory', deaths = 4, cs = 180, playedAt = '2026-10-01T10:00:00Z'} = {}) {
  const participants = [100, 200].flatMap(teamId =>
    ROLES.map(role => ({
      teamId,
      role,
      isPlayer: teamId === 100 && role === 'Mid',
      kills: 3,
      deaths: teamId === 100 && role === 'Mid' ? deaths : 4,
      assists: 6,
      cs: teamId === 100 && role === 'Mid' ? cs : 180,
      goldEarned: 10000,
      damageToChampions: 15000,
      visionScore: 20,
    })),
  );
  const match = {
    id,
    result,
    role: 'Mid',
    champion: 'Ahri',
    queue: 'Ranked Solo',
    playedAt,
    durationMinutes: 30,
    kills: 3,
    deaths,
    assists: 6,
    cs,
    teamKills: 15,
  };
  return {match, detail: {durationSeconds: 1800, participants}};
}
const historyOf = games => ({
  profile: {riotId: 'Me#OCE', region: 'OCE'},
  matches: games.map(g => g.match),
  details: Object.fromEntries(games.map(g => [g.match.id, g.detail])),
});
const comparison = {
  lane: {metrics: [{id: 'csPerMin', higherIsBetter: true, consistentlyBehind: true}]},
  winLoss: {
    available: true,
    metrics: [{id: 'deathsPer30', higherIsBetter: false, notable: true, favorsWins: true}],
  },
  self: {available: false},
};

test('plan focus prefers a consistent lane deficit, then the biggest win/loss difference', () => {
  assert.deepEqual(choosePlanFocus(comparison, []), ['csPerMin', 'deathsPer30']);
  const none = {lane: {metrics: []}, winLoss: {available: false}, self: {available: false}};
  assert.deepEqual(choosePlanFocus(none, [{id: 'survival'}, {id: 'vision'}]), [
    'deathsPer30',
    'visionPerMin',
  ]);
  assert.deepEqual(choosePlanFocus(none, []), []);
});

test('a plan records the baseline, a 10% target in the right direction and the known games', () => {
  const games = Array.from({length: 6}, (_, i) => game(`g${i}`, {deaths: 5, cs: 180}));
  const plan = createPlan(historyOf(games), ['csPerMin', 'deathsPer30'], '2026-10-21T09:00:00Z');
  assert.equal(plan.account, 'Me#OCE|OCE');
  assert.equal(plan.knownIds.length, 6);
  const cs = plan.focus.find(f => f.id === 'csPerMin');
  assert.equal(cs.baseline, 6);
  assert.ok(Math.abs(cs.target - 6.6) < 1e-9);
  const deaths = plan.focus.find(f => f.id === 'deathsPer30');
  assert.equal(deaths.baseline, 5);
  assert.equal(deaths.target, 4.5);
});

test('evaluation uses the first five games played after the plan and reports each target', () => {
  const before = Array.from({length: 6}, (_, i) => game(`g${i}`, {deaths: 5, cs: 180}));
  const plan = createPlan(historyOf(before), ['csPerMin', 'deathsPer30'], '2026-10-21T09:00:00Z');
  const after = Array.from({length: 3}, (_, i) => game(`n${i}`, {deaths: 3, cs: 180}));
  const partial = evaluatePlan(plan, historyOf([...after, ...before]));
  assert.equal(partial.played, 3);
  assert.equal(partial.complete, false);
  // Newest first: n5 is the most recent; n0..n4 are the first five after the plan.
  const more = Array.from({length: 6}, (_, i) => game(`n${i}`, {deaths: i === 5 ? 20 : 3, cs: 210}));
  const done = evaluatePlan(plan, historyOf([...more].reverse().concat(before)));
  assert.equal(done.played, 5);
  assert.equal(done.complete, true);
  const deaths = done.focus.find(f => f.id === 'deathsPer30');
  assert.equal(deaths.current, 3);
  assert.equal(deaths.met, true);
  const cs = done.focus.find(f => f.id === 'csPerMin');
  assert.equal(cs.current, 7);
  assert.equal(cs.met, true);
  assert.equal(
    evaluatePlan(plan, {...historyOf(before), profile: {riotId: 'Other#OCE', region: 'OCE'}}),
    null,
  );
});

test('plans persist per browser and tolerate unavailable or corrupt storage', () => {
  const store = new Map();
  const storage = {
    getItem: k => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, v),
    removeItem: k => store.delete(k),
  };
  const plan = createPlan(historyOf([game('g0')]), ['deathsPer30'], '2026-10-21T09:00:00Z');
  assert.equal(savePlan(plan, storage), true);
  assert.deepEqual(loadPlan(storage), plan);
  store.set('rift-review-practice-plan', '{bad json');
  assert.equal(loadPlan(storage), null);
  store.set('rift-review-practice-plan', JSON.stringify({version: 1, focus: 'x'}));
  assert.equal(loadPlan(storage), null);
  clearPlan(storage);
  assert.equal(loadPlan(storage), null);
  const broken = {
    getItem: () => {
      throw new Error('denied');
    },
    setItem: () => {
      throw new Error('denied');
    },
    removeItem: () => {},
  };
  assert.equal(loadPlan(broken), null);
  assert.equal(savePlan(plan, broken), false);
});

test('plan tracker offers to start, shows progress and the final verdict', async () => {
  const {renderPlanTracker} = await import('../public/practice-plan-view.js');
  const start = renderPlanTracker({
    candidates: ['csPerMin', 'deathsPer30'],
    evaluation: null,
    canTrack: true,
  });
  assert.match(start, /data-plan-start/);
  assert.match(start, /CS \/ phút/);
  assert.match(renderPlanTracker({candidates: [], evaluation: null, canTrack: true}), /Chưa có chỉ số/);
  assert.match(
    renderPlanTracker({candidates: ['csPerMin'], evaluation: null, canTrack: false}),
    /Tra cứu bằng Riot ID/,
  );
  const focus = [{id: 'deathsPer30', higherIsBetter: false, baseline: 5, target: 4.5, current: 3, met: true}];
  const progress = renderPlanTracker({
    candidates: [],
    canTrack: true,
    evaluation: {played: 2, complete: false, focus},
  });
  assert.match(progress, /2\/5/);
  assert.match(progress, /Đang theo dõi/);
  assert.match(progress, /data-plan-clear/);
  const done = renderPlanTracker({
    candidates: [],
    canTrack: true,
    evaluation: {
      played: 5,
      complete: true,
      focus: [
        ...focus,
        {
          ...focus[0],
          id: 'csPerMin',
          higherIsBetter: true,
          baseline: 6,
          target: 6.6,
          current: 6.1,
          met: false,
        },
      ],
    },
  });
  assert.match(done, /Đạt mục tiêu/);
  assert.match(done, /Chưa đạt/);
  assert.match(done, /1\/2/);
});
