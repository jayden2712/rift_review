import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, readFile, symlink, rm, stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createLocalServer} from '../server/local.js';
import {handleApi} from '../server/worker.js';
import {createLabSnapshot} from '../public/data-lab-model.js';
import {LAB_BODY_LIMIT} from '../server/data-lab.js';

async function start(t, extra = {}) {
  const root = await mkdtemp(join(tmpdir(), 'rift-lab-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const options = {env: {DATA_LAB_ENABLED: '1'}, labDirectory: join(root, 'snapshots'), ...extra};
  const server = createLocalServer(options);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => {server.close(resolve); server.closeAllConnections();}));
  const origin = `http://127.0.0.1:${server.address().port}`;
  return {root, options, origin, get: path => fetch(origin + path), post: (path, body, headers = {}) => fetch(origin + path, {
    method: 'POST', headers: {'Content-Type': 'application/json', ...headers}, body: JSON.stringify(body),
  })};
}

test('Data Lab defaults off and rejects encoded static paths unless explicitly enabled', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'rift-lab-assets-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  await writeFile(join(dir, 'data-lab.js'), 'local-only-fixture');
  for (const flag of [undefined, '0', 'true', 1]) {
    const app = await start(t, {publicDirectory: dir, env: {DATA_LAB_ENABLED: flag}});
    for (const path of ['/api/lab/status', '/api/lab/snapshots', '/api/lab/enrich', '/data-lab.js', '/%64ata-lab.js', '/data%2dlab.js']) {
      assert.equal((await app.get(path)).status, 404, `${flag} ${path}`);
    }
  }
  const app = await start(t, {publicDirectory: dir});
  assert.deepEqual(await (await app.get('/api/lab/status')).json(), {enabled: true});
  assert.equal((await app.get('/data-lab.js')).status, 200);
});

test('Data Lab demo/import storage round trips safely, downgrades imported provenance and keeps files private', async t => {
  const app = await start(t);
  assert.deepEqual(await (await app.get('/api/lab/snapshots')).json(), {snapshots: []});
  const demoResponse = await app.post('/api/lab/demo', {count: 10});
  assert.equal(demoResponse.status, 200);
  const {snapshot} = await demoResponse.json();
  assert.equal(snapshot.source, 'demo');
  const save = await app.post('/api/lab/snapshots', {snapshot});
  assert.equal(save.status, 201);
  const stored = await save.json();
  assert.match(stored.id, /^[a-f0-9-]{36}$/);
  assert.equal(stored.snapshot.source, 'demo');
  assert.deepEqual((await (await app.get('/api/lab/snapshots/' + stored.id)).json()).snapshot, stored.snapshot);
  const list = await (await app.get('/api/lab/snapshots')).json();
  assert.equal(list.snapshots.length, 1);
  assert.equal(list.snapshots[0].count, 10);
  assert.equal(list.snapshots[0].source, 'demo');
  const forged = await app.post('/api/lab/snapshots', {snapshot: {...snapshot, source: 'riot'}});
  assert.equal((await forged.json()).snapshot.source, 'imported');
  assert.equal((await stat(join(app.options.labDirectory, stored.id + '.json'))).mode & 0o777, 0o600);
  for (const path of ['/api/lab/snapshots/not-an-id', '/api/lab/snapshots/%2e%2e%2fsecret', '/.local/data-lab/' + stored.id + '.json']) {
    assert.equal((await app.get(path)).status, 404);
  }
});

test('Data Lab validates methods, origins, body limits and malformed imports', async t => {
  const app = await start(t);
  assert.equal((await app.get('/api/lab/demo')).status, 405);
  assert.equal((await app.post('/api/lab/status', {})).status, 405);
  assert.equal((await app.post('/api/lab/unknown', {})).status, 404);
  assert.equal((await app.post('/api/lab/demo', {count: 500})).status, 400);
  assert.equal((await app.post('/api/lab/demo', {count: 10}, {Origin: 'https://evil.test'})).status, 403);
  assert.equal((await app.post('/api/lab/demo', {}, {'Content-Type': 'text/plain'})).status, 415);
  assert.equal((await app.post('/api/lab/snapshots', {text: 'x'.repeat(LAB_BODY_LIMIT)})).status, 413);
  assert.equal((await app.post('/api/lab/snapshots', {snapshot: {}})).status, 400);
  const invalid = await fetch(app.origin + '/api/lab/snapshots', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: '{'});
  assert.equal(invalid.status, 400);
  const missing = await app.post('/api/lab/collect', {riotId: 'Fixture#LAB', region: 'oce', count: 10});
  assert.equal((await missing.json()).error.code, 'RIOT_NOT_CONFIGURED');
});

test('Data Lab rejects storage directory and snapshot symlinks without exposing files', async t => {
  const app = await start(t);
  const privateDir = join(app.root, 'private');
  await mkdir(privateDir);
  await symlink(privateDir, app.options.labDirectory);
  assert.equal((await app.post('/api/lab/snapshots', {snapshot: (await (await app.post('/api/lab/demo', {count: 10})).json()).snapshot})).status, 500);
  await rm(app.options.labDirectory);
  await mkdir(app.options.labDirectory);
  const id = 'b151119b-99e0-4e12-8dd1-364bd7c85335';
  await writeFile(join(privateDir, 'secret.json'), '{"secret":"hidden-fixture"}');
  await symlink(join(privateDir, 'secret.json'), join(app.options.labDirectory, id + '.json'));
  const response = await app.get('/api/lab/snapshots/' + id);
  assert.equal(response.status, 404);
  assert.ok(!(await response.text()).includes('hidden-fixture'));
});

test('hosted API and generated Worker never expose Data Lab despite enabled env', async () => {
  const env = {DATA_LAB_ENABLED: '1', RIOT_API_KEY: 'fixture-private'};
  const headers = {'oai-authenticated-user-id': 'fixture-owner'};
  assert.equal((await handleApi(new Request('https://fixture.test/api/lab/status', {headers}), env)).status, 404);
  execFileSync(process.execPath, ['build.mjs']);
  const built = await readFile('dist/server/index.js', 'utf8');
  assert.ok(!built.includes('"/data-lab'));
  const worker = (await import(new URL('../dist/server/index.js', import.meta.url).href + '?lab-test')).default;
  for (const path of ['/api/lab/status', '/api/lab/snapshots', '/api/lab/enrich', '/data-lab.html', '/data-lab.js', '/data-lab-model.js', '/data-lab.css', '/%64ata-lab.js']) {
    assert.equal((await worker.fetch(new Request('https://fixture.test' + path, {headers}), env)).status, 404);
  }
});

test('Data Lab collects real-adapter raw matches, records excluded modes and saves before replying', async t => {
  const raw = JSON.parse(await readFile(new URL('fixtures/mayhem-match.json', import.meta.url), 'utf8'));
  const calls = [];
  const app = await start(t, {env: {DATA_LAB_ENABLED: '1', RIOT_API_KEY: 'fixture-private'}, fetchImpl: async (url, options) => {
    calls.push({url, key: options.headers['X-Riot-Token']});
    if (url.includes('/accounts/')) return Response.json({puuid: 'fixture-mayhem-player', gameName: 'Fixture', tagLine: 'LAB'});
    if (url.includes('/summoner/')) return Response.json({});
    if (url.includes('/ids?')) return Response.json([raw.metadata.matchId]);
    return Response.json(raw);
  }});
  const response = await app.post('/api/lab/collect', {riotId: 'Fixture#LAB', region: 'oce', count: 10});
  assert.equal(response.status, 201);
  const saved = await response.json();
  assert.equal(saved.snapshot.source, 'riot');
  assert.equal(saved.snapshot.records.length, 1);
  assert.equal(saved.snapshot.records[0].raw.projection, false);
  assert.deepEqual(saved.snapshot.records[0].raw.data, raw);
  assert.equal(calls.length, 4);
  assert.ok(calls.every(call => call.key === 'fixture-private'));
  assert.ok(calls.find(call => call.url.includes('/ids?')).url.endsWith('?start=0&count=10'));
  assert.equal((await app.get('/api/lab/snapshots/' + saved.id)).status, 200);
  assert.ok(!JSON.stringify(saved).includes('fixture-private'));
  assert.equal((await app.post('/api/lab/collect', {riotId: 'Fixture#LAB', region: 'oce', count: 10, mode: 'mayhem'})).status, 400);
});

test('Data Lab upstream empty/auth/access/timeout failures never fabricate or save demo data', async t => {
  for (const scenario of ['empty', '401', '403', 'timeout', 'bad-list', 'detail-404']) {
    const app = await start(t, {env: {DATA_LAB_ENABLED: '1', RIOT_API_KEY: 'fixture-private'}, fetchImpl: async url => {
      if (scenario === 'timeout') throw Object.assign(new Error('fixture-private'), {name: 'TimeoutError'});
      if (['401', '403'].includes(scenario)) return new Response('fixture-private', {status: Number(scenario)});
      if (url.includes('/accounts/')) return Response.json({puuid: 'fixture-puuid'});
      if (url.includes('/summoner/')) return Response.json({});
      if (url.includes('/ids?')) return Response.json(scenario === 'empty' ? [] : scenario === 'bad-list' ? ['https://evil.test'] : ['OC1_123']);
      return new Response('fixture-private', {status: 404});
    }});
    const response = await app.post('/api/lab/collect', {riotId: 'Fixture#LAB', region: 'oce', count: 10});
    assert.ok(response.status >= 400, scenario);
    const body = await response.json();
    assert.ok(body.error.code);
    assert.ok(!JSON.stringify(body).includes('fixture-private'));
    assert.equal(body.snapshot, undefined);
    assert.deepEqual(await (await app.get('/api/lab/snapshots')).json(), {snapshots: []});
  }
});

test('Data Lab refuses full or corrupt local storage without leaking raw file contents', async t => {
  const app = await start(t);
  await mkdir(app.options.labDirectory);
  await Promise.all(Array.from({length: 100}, (_, i) => writeFile(join(app.options.labDirectory, `fixture-${i}.json`), '{}')));
  const {snapshot} = await (await app.post('/api/lab/demo', {count: 10})).json();
  const full = await app.post('/api/lab/snapshots', {snapshot});
  assert.equal(full.status, 409);
  assert.equal((await full.json()).error.code, 'LAB_STORAGE_FULL');
  const id = 'b151119b-99e0-4e12-8dd1-364bd7c85335';
  await writeFile(join(app.options.labDirectory, id + '.json'), 'fixture-private-malformed-json');
  const invalid = await app.get('/api/lab/snapshots/' + id);
  assert.equal(invalid.status, 500);
  assert.ok(!(await invalid.text()).includes('fixture-private'));
});

async function enrichmentFixture() {
  const fixture = JSON.parse(await readFile(new URL('fixtures/mayhem-match.json', import.meta.url), 'utf8'));
  const raw = {...fixture, extension: {futureVersion: 2, untouched: ['zero', 0, null]}, info: {...fixture.info,
    mapId: 11, queueId: 420, teams: [{teamId: 100, objectives: {baron: {kills: 2}}}],
    participants: fixture.info.participants.map((p, i) => ({...p, teamPosition: 'MIDDLE', visionScore: 25, kills: i === 0 ? 12 : p.kills,
      perks: {styles: [{style: 8100, selections: [{perk: 8112}]}]}, unknownNested: {enabled: true}})),
  }};
  const {teams, ...projectedInfo} = raw.info;
  const projected = {...raw, info: {...projectedInfo, participants: raw.info.participants.map(({perks, unknownNested, ...p}) => p)}};
  const projected2 = {...projected, metadata: {matchId: 'OC1_240002'}};
  const snapshot = createLabSnapshot({rawMatches: [projected, projected2], playerPuuid: 'fixture-mayhem-player', profile: {riotId: 'Fixture#LAB', region: 'OCE'}}, {source: 'riot'});
  return {raw, snapshot: {...snapshot, schemaVersion: 1, records: snapshot.records.map(record => ({...record, raw: {...record.raw, projection: true}}))}};
}

test('enrichment fetches only one routed detail, preserves original JSON and creates a new snapshot without rewriting old bytes', async t => {
  const {raw, snapshot} = await enrichmentFixture(), calls = [];
  const app = await start(t, {env: {DATA_LAB_ENABLED: '1', RIOT_API_KEY: 'fixture-private'}, fetchImpl: async (url, options) => {
    calls.push({url, key: options.headers['X-Riot-Token']}); return Response.json(raw);
  }});
  const original = await (await app.post('/api/lab/snapshots', {snapshot})).json();
  const oldPath = join(app.options.labDirectory, original.id + '.json'), oldBytes = await readFile(oldPath, 'utf8');
  const response = await app.post('/api/lab/enrich', {snapshot: original.snapshot, matchId: raw.metadata.matchId});
  assert.equal(response.status, 201);
  const result = await response.json();
  assert.notEqual(result.id, original.id);
  assert.equal(await readFile(oldPath, 'utf8'), oldBytes);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://sea.api.riotgames.com/lol/match/v5/matches/' + raw.metadata.matchId);
  assert.equal(calls[0].key, 'fixture-private');
  assert.deepEqual(result.snapshot.records[0].raw.data, raw);
  assert.equal(result.snapshot.records[0].raw.projection, false);
  assert.equal(result.snapshot.records[0].source, 'riot');
  assert.equal(result.snapshot.records[1].source, 'imported');
  assert.equal(result.snapshot.records[1].raw.projection, true);
  assert.equal(result.snapshot.records[0].normalized.kills, 12);
  assert.equal(result.snapshot.records[0].metrics.kda.numerator, 24);
  assert.ok(!JSON.stringify(result).includes('fixture-private'));
  const repeat = await app.post('/api/lab/enrich', {snapshot: original.snapshot, matchId: raw.metadata.matchId, region: 'oce'});
  assert.equal(repeat.status, 201);
  assert.equal(calls.length, 1, 'enrichment uses the shared local Riot cache');
});

test('enrichment validates the projection, match ID, routing and unique selected player before contacting Riot', async t => {
  const {snapshot, raw} = await enrichmentFixture(); let calls = 0;
  const app = await start(t, {env: {DATA_LAB_ENABLED: '1', RIOT_API_KEY: 'fixture-private'}, fetchImpl: async () => {calls++; return Response.json(raw);}});
  const id = raw.metadata.matchId;
  const ambiguous = {...snapshot, records: snapshot.records.map((record, i) => i ? record : {...record, normalized: {...record.normalized,
    participants: record.normalized.participants.map((p, j) => ({...p, isPlayer: j < 2}))}})};
  const invalidRequests = [
    {snapshot, matchId: 'https://evil.test/private'}, {snapshot, matchId: 'ZZZ_123'},
    {snapshot, matchId: id, region: 'euw'}, {snapshot, matchId: id, region: 'https://evil.test'},
    {snapshot: ambiguous, matchId: id},
    {snapshot: {...createLabSnapshot(snapshot), records: snapshot.records.map(r => ({...r, raw: {...r.raw, projection: false, provenance: 'riot_original'}}))}, matchId: id},
    {snapshot: {...snapshot, records: snapshot.records.map(r => ({...r, raw: {kind: 'unavailable', data: null, projection: true}}))}, matchId: id},
  ];
  for (const [index, input] of invalidRequests.entries()) assert.equal((await app.post('/api/lab/enrich', input)).status, 400, 'invalid enrichment case ' + index);
  assert.equal((await app.get('/api/lab/enrich')).status, 405);
  assert.equal(calls, 0);
  assert.deepEqual(await (await app.get('/api/lab/snapshots')).json(), {snapshots: []});
});

test('failed enrichment never changes saved snapshots or presents upstream access errors as expired keys', async t => {
  const {snapshot, raw} = await enrichmentFixture();
  for (const scenario of ['403', '404', 'timeout', 'wrong-id', 'wrong-player']) {
    const app = await start(t, {env: {DATA_LAB_ENABLED: '1', RIOT_API_KEY: 'fixture-private'}, fetchImpl: async () => {
      if (['403', '404'].includes(scenario)) return new Response('fixture-private', {status: Number(scenario)});
      if (scenario === 'timeout') throw Object.assign(new Error('fixture-private'), {name: 'TimeoutError'});
      if (scenario === 'wrong-id') return Response.json({...raw, metadata: {matchId: 'OC1_1'}});
      return Response.json({...raw, info: {...raw.info, participants: raw.info.participants.map(p => ({...p, puuid: 'other-' + p.puuid}))}});
    }});
    const original = await (await app.post('/api/lab/snapshots', {snapshot})).json();
    const path = join(app.options.labDirectory, original.id + '.json'), before = await readFile(path, 'utf8');
    const response = await app.post('/api/lab/enrich', {snapshot: original.snapshot, matchId: raw.metadata.matchId});
    assert.ok(response.status >= 400, scenario);
    const body = await response.json();
    if (scenario === '403') assert.equal(body.error.code, 'RIOT_ACCESS_DENIED');
    assert.ok(!JSON.stringify(body).includes('fixture-private'));
    assert.equal(await readFile(path, 'utf8'), before);
    assert.equal((await (await app.get('/api/lab/snapshots')).json()).snapshots.length, 1);
  }
});


test('enrichment is local-only and a missing backend key never mutates imported data', async t => {
  const {snapshot, raw} = await enrichmentFixture();
  const app = await start(t);
  const request = {snapshot, matchId: raw.metadata.matchId};
  assert.equal((await app.post('/api/lab/enrich', request, {Origin: 'https://evil.test'})).status, 403);
  const response = await app.post('/api/lab/enrich', request);
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error.code, 'RIOT_NOT_CONFIGURED');
  assert.deepEqual(await (await app.get('/api/lab/snapshots')).json(), {snapshots: []});
  const disabled = await start(t, {env: {DATA_LAB_ENABLED: '0', RIOT_API_KEY: 'fixture-private'}});
  assert.equal((await disabled.post('/api/lab/enrich', request)).status, 404);
});

test('full raw snapshots above the former 2 MiB bound round-trip within the shared 8 MiB limit', async t => {
  const {raw} = await enrichmentFixture();
  const expanded = {...raw, unknownFuturePayload: 'x'.repeat(2 * 1024 * 1024)};
  const snapshot = createLabSnapshot({rawMatches: [expanded], playerPuuid: 'fixture-mayhem-player'}, {source: 'riot'});
  const app = await start(t);
  const response = await app.post('/api/lab/snapshots', {snapshot});
  assert.equal(response.status, 201);
  const saved = await response.json();
  assert.equal(saved.snapshot.records[0].raw.projection, false);
  assert.deepEqual(saved.snapshot.records[0].raw.data, expanded);
  const loaded = await (await app.get('/api/lab/snapshots/' + saved.id)).json();
  assert.deepEqual(loaded.snapshot.records[0].raw.data, expanded);
});
