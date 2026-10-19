import test from 'node:test';
import assert from 'node:assert/strict';
import {augmentStats} from '../public/augment-stats.js';

const match = (id, result, patch = {}) => ({id, result, queue: 'ARAM Mayhem', isRemake: null, ...patch});
const player = (teamId, augments, isPlayer = false) => ({teamId, isPlayer, augments});

test('augment statistics count the player and every lobby participant separately', () => {
  const matches = [match('a', 'Victory'), match('b', 'Defeat'), match('c', 'Victory')];
  const details = {
    a: {
      participants: [player(100, [{id: 1}, {id: 2}], true), player(100, [{id: 1}]), player(200, [{id: 3}])],
    },
    b: {participants: [player(200, [{id: 1}], true), player(100, [{id: 2}, {id: 3}])]},
    c: {participants: [player(100, null, true), player(200, [{id: 1}])]},
  };
  const stats = augmentStats(matches, details);
  assert.deepEqual(stats.self, {
    games: 2,
    rows: [
      {id: 1, picks: 2, wins: 1, winRate: 0.5},
      {id: 2, picks: 1, wins: 1, winRate: 1},
    ],
  });
  // Lobby: a → team 100 won, team 200 lost; b → team 200 lost, team 100 won; c → team 200 lost.
  assert.deepEqual(stats.lobby, {
    games: 3,
    players: 6,
    rows: [
      {id: 1, picks: 4, wins: 2, winRate: 0.5},
      {id: 3, picks: 2, wins: 1, winRate: 0.5},
      {id: 2, picks: 2, wins: 2, winRate: 1},
    ].sort((x, y) => y.picks - x.picks || y.winRate - x.winRate || x.id - y.id),
  });
});

test('augment statistics skip remakes, missing details, games without the player and invalid IDs', () => {
  const matches = [
    match('remake', 'Defeat', {isRemake: true}),
    match('none', 'Victory'),
    match('nobody', 'Victory'),
    match('bad', 'Victory'),
  ];
  const details = {
    remake: {participants: [player(100, [{id: 9}], true)]},
    nobody: {participants: [player(100, [{id: 9}])]},
    bad: {participants: [player(100, [{id: -1}, {id: 'x'}, null, {id: 7}], true)]},
  };
  const stats = augmentStats(matches, details);
  assert.deepEqual(stats.self.rows, [{id: 7, picks: 1, wins: 1, winRate: 1}]);
  assert.equal(stats.self.games, 1);
  assert.equal(stats.lobby.games, 1);
  assert.deepEqual(augmentStats([], {}), {
    self: {games: 0, rows: []},
    lobby: {games: 0, players: 0, rows: []},
  });
});

test('augment panel renders both scopes with names, rates and small-sample marking', async () => {
  const {renderAugmentPanel} = await import('../public/augment-view.js');
  const stats = {
    self: {games: 2, rows: [{id: 1386, picks: 2, wins: 1, winRate: 0.5}]},
    lobby: {
      games: 2,
      players: 20,
      rows: [
        {id: 1386, picks: 5, wins: 4, winRate: 0.8},
        {id: 999999, picks: 1, wins: 0, winRate: 0},
      ],
    },
  };
  const self = renderAugmentPanel(stats, 'self');
  assert.match(self, /Đi Đu Đưa Đi/);
  assert.match(self, /50%/);
  assert.match(self, /is-small-sample/);
  assert.match(self, /data-augment-scope="self"[^>]*aria-pressed="true"/);
  const lobby = renderAugmentPanel(stats, 'lobby');
  assert.match(lobby, /80%/);
  assert.match(lobby, /Augment #999999/);
  assert.match(lobby, /20 lượt chọn/);
  assert.match(
    renderAugmentPanel({self: {games: 0, rows: []}, lobby: {games: 0, players: 0, rows: []}}),
    /client LoL/,
  );
});
