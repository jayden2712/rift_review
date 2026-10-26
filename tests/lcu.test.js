import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {RiotError} from '../server/riot.js';
import {
  parseLockfile,
  installDirCandidates,
  findLcuCredentials,
  createLcuClient,
  loadLcuMayhem,
} from '../server/lcu.js';
import {mapLcuGame, championNames} from '../server/lcu-map.js';

const game = JSON.parse(readFileSync(new URL('./fixtures/lcu-mayhem-game.json', import.meta.url), 'utf8'));
const selfPuuid = 'fixture-puuid-self';
const champions = championNames([
  {id: 98, alias: 'Shen', name: 'Shen'},
  {id: 62, alias: 'MonkeyKing', name: 'Ngộ Không'},
]);
const lockfile = 'LeagueClient:1234:57155:s3cret-Pass_word:https';

test('lockfile parsing accepts the client format and rejects anything else', () => {
  assert.deepEqual(parseLockfile(lockfile + '\r\n'), {port: 57155, password: 's3cret-Pass_word'});
  for (const bad of [
    '',
    'LeagueClient:1234:57155:pw',
    'LeagueClient:1234:0:pw:https',
    'LeagueClient:1234:70000:pw:https',
    'LeagueClient:1234:57155:pw:http',
    'RiotClient:1234:57155:pw:https',
    'LeagueClient:1234:57155::https',
    'LeagueClient:x:57155:pw:https',
  ]) {
    assert.equal(parseLockfile(bad), null, bad);
  }
});

test('install directory candidates prefer the override, then Riot metadata, then the default', () => {
  const settings = 'product_install_full_path: "E:/League/Riot Games/League of Legends"\nother: 1\n';
  const readFile = path => {
    if (path.endsWith('league_of_legends.live.product_settings.yaml')) return settings;
    throw Object.assign(new Error('missing'), {code: 'ENOENT'});
  };
  assert.deepEqual(
    installDirCandidates({env: {LCU_INSTALL_DIR: 'D:/LoL'}, programData: 'C:/ProgramData', readFile}),
    ['D:/LoL', 'E:/League/Riot Games/League of Legends', 'C:/Riot Games/League of Legends'],
  );
  assert.deepEqual(installDirCandidates({env: {}, programData: 'C:/ProgramData', readFile: () => ''}), [
    'C:/Riot Games/League of Legends',
  ]);
});

test('credentials come from the first readable lockfile and a missing one means the client is closed', () => {
  const files = {[join('E:/LoL', 'lockfile')]: lockfile};
  const readFile = path => {
    if (Object.hasOwn(files, path)) return files[path];
    throw Object.assign(new Error('missing'), {code: 'ENOENT'});
  };
  assert.deepEqual(findLcuCredentials(['C:/none', 'E:/LoL'], readFile), {
    port: 57155,
    password: 's3cret-Pass_word',
  });
  assert.equal(findLcuCredentials(['C:/none'], readFile), null);
});

test('LCU client only issues allowlisted GET paths and never exposes the password in errors', async () => {
  const calls = [];
  const client = createLcuClient({
    credentials: {port: 57155, password: 's3cret-Pass_word'},
    requestImpl: async options => {
      calls.push(options);
      return {status: 200, body: '{"ok":true}'};
    },
  });
  assert.deepEqual(await client.get('/lol-summoner/v1/current-summoner'), {ok: true});
  assert.deepEqual(await client.get('/lol-match-history/v1/games/7123'), {ok: true});
  assert.equal(calls[0].port, 57155);
  assert.equal(calls[0].path, '/lol-summoner/v1/current-summoner');
  assert.match(calls[0].authorization, /^Basic /);
  for (const path of [
    '/lol-lobby/v2/lobby',
    '/lol-match-history/v1/games/7123/../../lol-login',
    '/lol-match-history/v1/games/abc',
    '/riotclient/kill-and-restart-ux',
    'https://example.com/',
  ]) {
    await assert.rejects(
      client.get(path),
      error => error.code === 'LCU_PATH_REJECTED' && !error.message.includes('s3cret'),
    );
  }
  assert.equal(calls.length, 2);
});

test('LCU client maps HTTP and transport failures to explicit errors', async () => {
  const make = response =>
    createLcuClient({credentials: {port: 1, password: 'pw'}, requestImpl: async () => response});
  await assert.rejects(make({status: 404, body: '{}'}).get('/lol-match-history/v1/games/1'), {
    code: 'LCU_NOT_FOUND',
  });
  await assert.rejects(make({status: 500, body: ''}).get('/lol-summoner/v1/current-summoner'), {
    code: 'LCU_UNAVAILABLE',
  });
  await assert.rejects(make({status: 200, body: 'not json'}).get('/lol-summoner/v1/current-summoner'), {
    code: 'LCU_BAD_DATA',
  });
  const refused = createLcuClient({
    credentials: {port: 1, password: 'pw'},
    requestImpl: async () => {
      throw Object.assign(new Error('connect ECONNREFUSED'), {code: 'ECONNREFUSED'});
    },
  });
  await assert.rejects(
    refused.get('/lol-summoner/v1/current-summoner'),
    error => error instanceof RiotError && error.code === 'LCU_CLIENT_CLOSED',
  );
});

test('a real Mayhem game maps to a History v3 match and detail with augments', () => {
  const {match, detail} = mapLcuGame(game, selfPuuid, champions);
  assert.equal(match.id, 'OC1_1000001');
  assert.equal(match.queue, 'ARAM Mayhem');
  assert.equal(match.champion, 'Shen');
  assert.equal(match.role, null);
  assert.equal(match.result, 'Defeat');
  assert.deepEqual([match.kills, match.deaths, match.assists], [7, 10, 12]);
  assert.equal(match.durationMinutes, game.gameDuration / 60);
  assert.equal(match.playedAt, new Date(game.gameCreation).toISOString());
  assert.equal(match.teamKills, 25);
  assert.equal(match.isRemake, null);
  assert.equal(detail.durationSeconds, game.gameDuration);
  assert.equal(detail.participants.length, 10);
  const self = detail.participants.find(p => p.isPlayer);
  assert.equal(self.riotId, 'Fixture Self#FIX');
  assert.deepEqual(self.items, [2504, 3111, 3748, 3083, 0, 0, 2052]);
  assert.deepEqual(self.summonerSpells, [4, 32]);
  assert.deepEqual(self.augments, [{id: 1386}, {id: 1071}, {id: 1349}]);
  assert.equal(self.runes, null);
  assert.equal(self.role, null);
  assert.equal(detail.participants.filter(p => p.isPlayer).length, 1);
  assert.ok(detail.participants.every((p, i, all) => i === 0 || all[i - 1].teamId <= p.teamId));
  assert.equal(detail.participants.find(p => p.champion === 'Chưa rõ') !== undefined, true);
});

test('mapping skips other queues and rejects games that do not contain the player exactly once', () => {
  assert.deepEqual(mapLcuGame({...game, queueId: 450}, selfPuuid, champions), {
    skipped: 'Trận không thuộc ARAM Mayhem (queue 2400)',
  });
  assert.throws(() => mapLcuGame(game, 'someone-else', champions), {code: 'PLAYER_MISMATCH'});
  assert.throws(() => mapLcuGame({...game, participants: 'x'}, selfPuuid, champions), {code: 'LCU_BAD_DATA'});
  const noDuration = mapLcuGame({...game, gameDuration: 0}, selfPuuid, champions);
  assert.ok(noDuration.skipped);
});

test('loading Mayhem from the client fetches each Mayhem game once and returns the shared envelope', async () => {
  const listEntry = {
    ...game,
    participants: [game.participants[0]],
    participantIdentities: [game.participantIdentities[0]],
  };
  const calls = [];
  const client = {
    async get(path) {
      calls.push(path);
      if (path === '/lol-summoner/v1/current-summoner')
        return {puuid: selfPuuid, gameName: 'Fixture Self', tagLine: 'FIX', profileIconId: 685};
      if (path === '/riotclient/region-locale') return {region: 'OC1'};
      if (path.startsWith('/lol-match-history/v1/products/lol/current-summoner/matches'))
        return {games: {games: [listEntry, {...listEntry, gameId: 5, queueId: 3100}]}};
      if (path === '/lol-match-history/v1/games/1000001') return game;
      if (path === '/lol-game-data/assets/v1/champion-summary.json')
        return [{id: 98, alias: 'Shen', name: 'Shen'}];
      throw new Error('unexpected ' + path);
    },
  };
  const result = await loadLcuMayhem(client);
  assert.equal(calls.filter(path => path.includes('/games/')).length, 1);
  assert.equal(result.history.schemaVersion, 3);
  assert.deepEqual(result.history.profile, {
    riotId: 'Fixture Self#FIX',
    region: 'OCE',
    rank: '',
    profileIconId: 685,
  });
  assert.equal(result.history.matches.length, 1);
  assert.ok(result.history.details.OC1_1000001);
  assert.equal(result.source.provider, 'lcu');
  assert.equal(result.source.mode, 'mayhem');
  assert.equal(result.source.accountKey, 'oc1:' + selfPuuid);
  assert.equal(result.source.hasMore, false);
  assert.deepEqual(result.warnings, []);
});

test('loading from the client reports a missing sign-in and an empty Mayhem history explicitly', async () => {
  const signedOut = {get: async () => ({})};
  await assert.rejects(loadLcuMayhem(signedOut), {code: 'LCU_NOT_SIGNED_IN'});
  const noMayhem = {
    async get(path) {
      if (path === '/lol-summoner/v1/current-summoner')
        return {puuid: selfPuuid, gameName: 'A', tagLine: 'B'};
      if (path === '/riotclient/region-locale') return {region: 'OC1'};
      if (path.includes('/matches')) return {games: {games: [{gameId: 5, queueId: 420}]}};
      return [];
    },
  };
  await assert.rejects(loadLcuMayhem(noMayhem), {code: 'NO_MATCHES'});
});
