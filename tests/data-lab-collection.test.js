import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm, readFile, readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createDataLab} from '../server/data-lab.js';

const fixture = JSON.parse(await readFile(new URL('./fixtures/mayhem-match.json', import.meta.url), 'utf8'));
const raw = id => ({...fixture, metadata: {...fixture.metadata, matchId: id}});
async function setup(t, detail) {
  const directory = await mkdtemp(join(tmpdir(), 'lab-partial-'));
  t.after(() => rm(directory, {recursive: true, force: true}));
  const calls = [];
  const handler = createDataLab({
    directory,
    env: {RIOT_API_KEY: 'fixture-private'},
    fetchImpl: async url => {
      if (url.includes('/accounts/')) return Response.json({puuid: 'fixture-mayhem-player'});
      if (url.includes('/summoner/')) return Response.json({});
      if (url.includes('/ids?')) return Response.json(['OC1_1001', 'OC1_1002', 'OC1_1003']);
      const id = url.split('/').at(-1);
      calls.push(id);
      return detail(id, calls.length);
    },
  });
  const post = async (path, body) => {
    const response = await handler(
      new Request('http://localhost/api/lab/' + path, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(body),
      }),
    );
    return {status: response.status, body: await response.json()};
  };
  return {
    calls,
    directory,
    post,
    collect: () => post('collect', {riotId: 'Fixture#LAB', region: 'oce', count: 10}),
  };
}
test('collection retains successful details across a missing match and saves retry report', async t => {
  const app = await setup(t, id =>
    id === 'OC1_1002' ? new Response('', {status: 404}) : Response.json(raw(id)),
  );
  const result = await app.collect();
  assert.equal(result.status, 201);
  assert.deepEqual(
    result.body.snapshot.records.map(r => r.matchId),
    ['OC1_1001', 'OC1_1003'],
  );
  assert.deepEqual(
    [
      result.body.collection.attempted,
      result.body.collection.succeeded,
      result.body.collection.failed,
      result.body.collection.notAttempted,
    ],
    [3, 2, 1, 0],
  );
  assert.equal(result.body.collection.failures[0].code, 'RIOT_NOT_FOUND');
  assert.deepEqual(result.body.snapshot.collection, result.body.collection);
});
test('global access failure stops following details and preserves a successful partial snapshot', async t => {
  const app = await setup(t, id =>
    id === 'OC1_1002' ? new Response('', {status: 403}) : Response.json(raw(id)),
  );
  const result = await app.collect();
  assert.equal(result.status, 201);
  assert.equal(app.calls.length, 2);
  assert.equal(result.body.collection.notAttempted, 1);
  assert.equal(result.body.collection.failures[0].retryable, false);
  assert.ok(!JSON.stringify(result.body).includes('fixture-private'));
});
test('no successful detail returns an explicit report and creates no snapshot', async t => {
  const app = await setup(t, () => new Response('', {status: 404}));
  const result = await app.collect();
  assert.equal(result.body.error.code, 'LAB_NO_SUCCESS');
  assert.equal(result.body.collection.failed, 3);
  assert.equal(result.body.snapshot, undefined);
  assert.deepEqual(await readdir(app.directory), []);
});
test('retry requests only selected failed IDs and rejects injected IDs', async t => {
  let retry = false;
  const app = await setup(t, id =>
    id === 'OC1_1002' && !retry ? new Response('', {status: 404}) : Response.json(raw(id)),
  );
  const initial = await app.collect();
  retry = true;
  const rejected = await app.post('retry', {snapshot: initial.body.snapshot, matchIds: ['OC1_9999']});
  assert.equal(rejected.status, 400);
  const result = await app.post('retry', {snapshot: initial.body.snapshot});
  assert.equal(result.status, 201);
  assert.deepEqual(app.calls, ['OC1_1001', 'OC1_1002', 'OC1_1003', 'OC1_1002']);
  assert.equal(result.body.snapshot.records.length, 3);
  assert.equal(result.body.collection.failures.length, 0);
});
test('failed retry retains prior saved file and reports error without a new snapshot', async t => {
  const app = await setup(t, id =>
    id === 'OC1_1002' ? new Response('', {status: 404}) : Response.json(raw(id)),
  );
  const initial = await app.collect(),
    before = await readFile(join(app.directory, initial.body.id + '.json'), 'utf8');
  const result = await app.post('retry', {snapshot: initial.body.snapshot});
  assert.equal(result.body.error.code, 'LAB_NO_SUCCESS');
  assert.equal(result.body.snapshot, undefined);
  assert.equal((await readdir(app.directory)).length, 1);
  assert.equal(await readFile(join(app.directory, initial.body.id + '.json'), 'utf8'), before);
});
test('retry rejects tampered selected player identity without requesting a detail', async t => {
  const app = await setup(t, id =>
    id === 'OC1_1002' ? new Response('', {status: 404}) : Response.json(raw(id)),
  );
  const initial = await app.collect();
  const altered = {
    ...initial.body.snapshot,
    collection: {...initial.body.collection, playerPuuid: 'someone-else'},
  };
  const result = await app.post('retry', {snapshot: altered});
  assert.equal(result.status, 400);
  assert.equal(app.calls.length, 3);
});
test('retry resumes only pending IDs after a global stop', async t => {
  let repaired = false;
  const app = await setup(t, id =>
    id === 'OC1_1002' && !repaired ? new Response('', {status: 403}) : Response.json(raw(id)),
  );
  const initial = await app.collect();
  repaired = true;
  const result = await app.post('retry', {snapshot: initial.body.snapshot});
  assert.equal(result.status, 201);
  assert.deepEqual(app.calls, ['OC1_1001', 'OC1_1002', 'OC1_1003']);
  assert.equal(result.body.collection.succeeded, 1);
  assert.equal(result.body.collection.notAttemptedIds.length, 0);
  assert.equal(result.body.collection.failures[0].matchId, 'OC1_1002');
});
test('401 and exhausted 429 halt a batch and mark remaining IDs not attempted', async t => {
  for (const status of [401, 429]) {
    const app = await setup(t, id =>
      id === 'OC1_1002' ? new Response('', {status, headers: {'Retry-After': '1'}}) : Response.json(raw(id)),
    );
    const result = await app.collect();
    assert.equal(result.status, 201);
    assert.deepEqual(app.calls, ['OC1_1001', 'OC1_1002']);
    assert.equal(result.body.collection.notAttempted, 1);
    assert.deepEqual(result.body.collection.notAttemptedIds, ['OC1_1003']);
    assert.equal(result.body.collection.failures[0].status, status);
  }
});
