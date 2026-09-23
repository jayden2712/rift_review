import test from 'node:test';
import assert from 'node:assert/strict';
import {request} from 'node:http';
import {mkdtemp, mkdir, writeFile, symlink, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createLocalServer} from '../server/local.js';
import {riotDataSource} from '../public/riot-source.js';

async function start(t, options = {}) {
  const server = createLocalServer(options);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => {
    server.close(resolve);
    server.closeAllConnections();
  }));
  return `http://127.0.0.1:${server.address().port}`;
}

function rawRequest(origin, {path = '/', method = 'GET', headers = {}, chunks = []} = {}) {
  return new Promise((resolve, reject) => {
    const req = request(origin, {path, method, headers}, res => {
      const body = [];
      res.on('data', chunk => body.push(chunk));
      res.on('end', () => resolve({status: res.statusCode, body: Buffer.concat(body).toString(), headers: res.headers}));
    });
    req.on('error', reject);
    for (const chunk of chunks) req.write(chunk);
    req.end();
  });
}

test('local serves UI and modules, supports HEAD, and reports missing configuration', async t => {
  const origin = await start(t);
  const page = await fetch(origin);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /id="riot-lookup"/);
  assert.match(page.headers.get('content-type'), /text\/html/);
  const script = await fetch(`${origin}/app.js`);
  assert.equal(script.status, 200);
  assert.match(script.headers.get('content-type'), /javascript/);
  const head = await fetch(origin, {method: 'HEAD'});
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
  const status = await fetch(`${origin}/api/status`);
  assert.deepEqual(await status.json(), {riotConfigured: false});
  assert.equal(status.headers.get('cache-control'), 'private, no-store');
  assert.equal((await fetch(origin, {method: 'POST'})).status, 405);
  assert.equal((await fetch(`${origin}/api/unknown`)).status, 404);
  const localhost = await rawRequest(origin, {headers: {Host: origin.replace('http://127.0.0.1', 'localhost')}});
  assert.equal(localhost.status, 200);
});

test('missing key has an actionable API error without requiring hosted login', async t => {
  const origin = await start(t);
  await assert.rejects(riotDataSource.load({riotId: 'Fixture#TEST', region: 'oce'}, {
    fetchImpl: (path, options) => fetch(origin + path, options),
  }), error => error.code === 'RIOT_NOT_CONFIGURED');
});

test('local rejects hostile hosts, browser origins and request targets before using Riot', async t => {
  let upstreamCalls = 0;
  const origin = await start(t, {env: {RIOT_API_KEY: 'fixture-secret'}, fetchImpl: async () => {
    upstreamCalls += 1;
    return Response.json({});
  }});
  for (const headers of [
    {Host: 'evil.test'}, {Host: 'localhost:1'},
    {Origin: 'https://evil.test'}, {Origin: 'null'},
    {'Sec-Fetch-Site': 'cross-site'},
    {Host: 'evil.test', 'oai-authenticated-user-id': 'forged-owner'},
  ]) {
    const result = await rawRequest(origin, {path: '/api/status', headers});
    assert.equal(result.status, 403);
    assert.ok(!result.body.includes('fixture-secret'));
  }
  for (const path of ['//evil.test/api/status', '/\\evil.test/api/status', 'http://evil.test/api/status']) {
    assert.equal((await rawRequest(origin, {path})).status, 400);
  }
  assert.equal(upstreamCalls, 0);
});

test('local bounds streamed bodies and preserves API validation', async t => {
  const origin = await start(t, {env: {RIOT_API_KEY: 'fixture-secret'}});
  const headers = {'Content-Type': 'application/json'};
  const large = await rawRequest(origin, {
    path: '/api/history', method: 'POST', headers, chunks: ['x'.repeat(1024), 'x'.repeat(1025)],
  });
  assert.equal(large.status, 413);
  assert.equal(JSON.parse(large.body).error.code, 'INPUT_TOO_LARGE');
  const invalid = await rawRequest(origin, {path: '/api/history', method: 'POST', headers, chunks: ['{']});
  assert.equal(invalid.status, 400);
  assert.equal(JSON.parse(invalid.body).error.code, 'INVALID_JSON');
  assert.equal((await fetch(`${origin}/api/history`)).status, 405);
  assert.equal((await fetch(`${origin}/api/history`, {method: 'POST', body: '{}'})).status, 415);
  const query = await fetch(`${origin}/api/history`, {method: 'POST', headers, body: JSON.stringify({riotId: 'Invalid'})});
  assert.equal(query.status, 400);
});

test('local never exposes project files, traversal paths or symlink targets', async t => {
  const root = await mkdtemp(join(tmpdir(), 'rift-local-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const publicDirectory = join(root, 'public');
  await mkdir(publicDirectory);
  await writeFile(join(root, 'private.js'), 'private-value');
  await writeFile(join(publicDirectory, 'index.html'), '<h1>Fixture</h1>');
  await symlink(join(root, 'private.js'), join(publicDirectory, 'linked.js'));
  const origin = await start(t, {publicDirectory});
  for (const path of ['/.env', '/.env.example', '/server/riot.js', '/../private.js', '/%2e%2e/private.js', '/%2f..%2fprivate.js', '/linked.js', '/missing.js', '/%ZZ']) {
    const response = await rawRequest(origin, {path});
    assert.ok([400, 404].includes(response.status), `${path}: ${response.status}`);
    assert.ok(!response.body.includes('private-value'));
  }
});

test('browser provider completes lookup through local HTTP with mocked Riot and no key exposure', async t => {
  const calls = [];
  const participants = Array.from({length: 10}, (_, i) => ({
    puuid: `player-${i}`, teamId: i < 5 ? 100 : 200, championName: 'Ahri',
    teamPosition: 'MIDDLE', win: i < 5, kills: 5, deaths: 3, assists: 7,
    totalMinionsKilled: 170, neutralMinionsKilled: 10, visionScore: 25,
  }));
  const origin = await start(t, {env: {RIOT_API_KEY: 'fixture-secret'}, fetchImpl: async (url, options) => {
    calls.push({url, token: options.headers['X-Riot-Token']});
    if (url.includes('/accounts/')) return Response.json({puuid: 'player-0', gameName: 'Fixture', tagLine: 'TEST'});
    if (url.includes('/summoner/')) return Response.json({puuid: 'player-0'});
    if (url.includes('/ids?')) return Response.json(['OC1_123']);
    return Response.json({metadata: {matchId: 'OC1_123'}, info: {participants, mapId: 11, queueId: 420, gameDuration: 1800}});
  }});
  const status = await fetch(`${origin}/api/status`);
  assert.deepEqual(await status.json(), {riotConfigured: true});
  const result = await riotDataSource.load({riotId: 'Fixture#TEST', region: 'oce', count: 10}, {
    fetchImpl: (path, options) => fetch(origin + path, {...options, headers: {...options.headers, Origin: origin}}),
  });
  assert.equal(result.history.matches[0].champion, 'Ahri');
  assert.equal(result.details.OC1_123.participants.length, 10);
  assert.equal(calls.length, 4);
  assert.ok(calls.every(call => call.token === 'fixture-secret'));
  assert.ok(!JSON.stringify(result).includes('fixture-secret'));
});

test('local sanitizes upstream failures', async t => {
  const origin = await start(t, {env: {RIOT_API_KEY: 'fixture-secret'}, fetchImpl: async () => {
    throw new Error('fixture-secret');
  }});
  const response = await fetch(`${origin}/api/history`, {
    method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({riotId: 'Fixture#TEST', region: 'oce'}),
  });
  assert.equal(response.status, 502);
  assert.ok(!(await response.text()).includes('fixture-secret'));
});
