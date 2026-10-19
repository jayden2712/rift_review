import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {RiotError} from '../server/riot.js';
import {createLocalServer} from '../server/local.js';
import {handleApi} from '../server/worker.js';
import {loadLocalConfig} from '../server/local-config.js';

const game = JSON.parse(readFileSync(new URL('./fixtures/lcu-mayhem-game.json', import.meta.url), 'utf8'));
const fakeClient = {
  async get(path) {
    if (path === '/lol-summoner/v1/current-summoner')
      return {puuid: 'fixture-puuid-self', gameName: 'Fixture Self', tagLine: 'FIX'};
    if (path === '/riotclient/region-locale') return {region: 'OC1'};
    if (path.includes('/matches?')) return {games: {games: [{gameId: game.gameId, queueId: 2400}]}};
    if (path.includes('/games/')) return game;
    if (path.includes('champion-summary')) return [{id: 98, alias: 'Shen', name: 'Shen'}];
    throw new Error('unexpected ' + path);
  },
};

async function start(t, options) {
  const server = createLocalServer(options);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(
    () =>
      new Promise(resolve => {
        server.close(resolve);
        server.closeAllConnections();
      }),
  );
  const origin = `http://127.0.0.1:${server.address().port}`;
  return {
    origin,
    get: path => fetch(origin + path),
    post: (path, headers = {'Content-Type': 'application/json'}) =>
      fetch(origin + path, {method: 'POST', headers, body: '{}'}),
  };
}

test('League client routes stay off unless LCU_ENABLED is exactly 1', async t => {
  for (const flag of [undefined, '0', 'true']) {
    const app = await start(t, {env: {LCU_ENABLED: flag}, lcuConnect: () => fakeClient});
    assert.equal((await app.get('/api/lcu/status')).status, 404, String(flag));
    assert.equal((await app.post('/api/lcu/import')).status, 404, String(flag));
  }
});

test('enabled routes report the signed-in account and import Mayhem history', async t => {
  const app = await start(t, {env: {LCU_ENABLED: '1'}, lcuConnect: () => fakeClient});
  assert.deepEqual(await (await app.get('/api/lcu/status')).json(), {
    enabled: true,
    status: 'connected',
    riotId: 'Fixture Self#FIX',
  });
  const response = await app.post('/api/lcu/import');
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.source.provider, 'lcu');
  assert.equal(payload.history.matches[0].id, 'OC1_1000001');
  assert.deepEqual(payload.history.details.OC1_1000001.participants.find(p => p.isPlayer).augments, [
    {id: 1386},
    {id: 1071},
    {id: 1349},
  ]);
});

test('enabled routes validate method, content type and origin', async t => {
  const app = await start(t, {env: {LCU_ENABLED: '1'}, lcuConnect: () => fakeClient});
  assert.equal((await app.get('/api/lcu/import')).status, 405);
  assert.equal((await app.post('/api/lcu/status')).status, 405);
  assert.equal((await app.get('/api/lcu/other')).status, 404);
  assert.equal((await app.post('/api/lcu/import', {'Content-Type': 'text/plain'})).status, 415);
  const crossSite = await app.post('/api/lcu/import', {
    'Content-Type': 'application/json',
    Origin: 'https://evil.test',
  });
  assert.equal(crossSite.status, 403);
});

test('a closed client is a status, and an import error, without leaking details', async t => {
  const closed = () => {
    throw new RiotError('LCU_CLIENT_CLOSED', 'Không thấy client LoL đang chạy.', 503);
  };
  const app = await start(t, {env: {LCU_ENABLED: '1'}, lcuConnect: closed});
  assert.deepEqual(await (await app.get('/api/lcu/status')).json(), {enabled: true, status: 'client_closed'});
  const response = await app.post('/api/lcu/import');
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error.code, 'LCU_CLIENT_CLOSED');
  const crashing = await start(t, {
    env: {LCU_ENABLED: '1'},
    lcuConnect: () => {
      throw new Error('C:/secret/path lockfile password=abc');
    },
  });
  const failed = await crashing.post('/api/lcu/import');
  assert.equal(failed.status, 500);
  assert.doesNotMatch(await failed.text(), /secret|password/);
});

test('the hosted API never serves League client routes', async () => {
  const headers = {'oai-authenticated-user-id': 'fixture-owner'};
  const env = {LCU_ENABLED: '1', RIOT_API_KEY: 'fixture'};
  for (const path of ['/api/lcu/status', '/api/lcu/import'])
    assert.equal((await handleApi(new Request('https://fixture.test' + path, {headers}), env)).status, 404);
});

test('local config reads LCU_ENABLED and LCU_INSTALL_DIR', () => {
  const saved = {...process.env};
  try {
    process.env.LCU_ENABLED = '1';
    process.env.LCU_INSTALL_DIR = ' E:/League/Riot Games/League of Legends ';
    const {env} = loadLocalConfig('missing.env');
    assert.equal(env.LCU_ENABLED, '1');
    assert.equal(env.LCU_INSTALL_DIR, 'E:/League/Riot Games/League of Legends');
    process.env.LCU_ENABLED = 'yes';
    assert.equal(loadLocalConfig('missing.env').env.LCU_ENABLED, '0');
  } finally {
    for (const key of ['LCU_ENABLED', 'LCU_INSTALL_DIR']) {
      if (Object.hasOwn(saved, key)) process.env[key] = saved[key];
      else delete process.env[key];
    }
  }
});
