import test from 'node:test';
import assert from 'node:assert/strict';
import {createLocalServer} from '../server/local.js';
import {handleApi} from '../server/worker.js';
import {loadLocalConfig} from '../server/local-config.js';

const facts = {language: 'vi', games: 20, takeaways: ['Bạn kém CS ở 14/19 trận (6,6 so với 7,0).']};
const fakeModel = async () =>
  Response.json({
    model: 'fixture-model',
    choices: [{message: {content: JSON.stringify({summary: 'Bạn kém CS ở 14/19 trận.', focus: []})}}],
  });

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
    get: path => fetch(origin + path),
    post: (path, body, headers = {'Content-Type': 'application/json'}) =>
      fetch(origin + path, {
        method: 'POST',
        headers,
        body: typeof body === 'string' ? body : JSON.stringify(body),
      }),
  };
}

test('AI routes stay off unless AI_ENABLED is exactly 1', async t => {
  for (const flag of [undefined, '0', 'true']) {
    const app = await start(t, {env: {AI_ENABLED: flag}, fetchImpl: fakeModel});
    assert.equal((await app.get('/api/ai/status')).status, 404);
    assert.equal((await app.post('/api/ai/summary', {facts})).status, 404);
  }
});

test('enabled routes report the model and return a grounded summary', async t => {
  const app = await start(t, {env: {AI_ENABLED: '1', AI_MODEL: 'qwen3:4b-instruct'}, fetchImpl: fakeModel});
  assert.deepEqual(await (await app.get('/api/ai/status')).json(), {
    enabled: true,
    model: 'qwen3:4b-instruct',
  });
  const response = await app.post('/api/ai/summary', {facts});
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    summary: 'Bạn kém CS ở 14/19 trận.',
    focus: [],
    removed: 0,
    model: 'fixture-model',
  });
});

test('enabled routes validate method, content type, size and facts', async t => {
  const app = await start(t, {env: {AI_ENABLED: '1'}, fetchImpl: fakeModel});
  assert.equal((await app.get('/api/ai/summary')).status, 405);
  assert.equal((await app.post('/api/ai/summary', {facts}, {'Content-Type': 'text/plain'})).status, 415);
  assert.equal((await app.post('/api/ai/summary', '{')).status, 400);
  assert.equal((await app.post('/api/ai/summary', {facts: {player: 'Name#TAG'}})).status, 400);
  assert.equal((await app.post('/api/ai/summary', {facts: {text: 'x'.repeat(40000)}})).status, 413);
  const down = await start(t, {
    env: {AI_ENABLED: '1'},
    fetchImpl: async () => {
      throw new TypeError('fetch failed');
    },
  });
  const failed = await down.post('/api/ai/summary', {facts});
  assert.equal(failed.status, 503);
  assert.equal((await failed.json()).error.code, 'AI_UNAVAILABLE');
});

test('the hosted API never serves AI routes', async () => {
  const headers = {'oai-authenticated-user-id': 'fixture-owner'};
  for (const path of ['/api/ai/status', '/api/ai/summary'])
    assert.equal(
      (await handleApi(new Request('https://fixture.test' + path, {headers}), {AI_ENABLED: '1'})).status,
      404,
    );
});

test('local config reads the AI settings', () => {
  const keys = ['AI_ENABLED', 'AI_BASE_URL', 'AI_MODEL', 'AI_API_KEY'];
  const saved = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  try {
    Object.assign(process.env, {
      AI_ENABLED: '1',
      AI_BASE_URL: ' http://127.0.0.1:11434/v1 ',
      AI_MODEL: 'qwen3:4b-instruct',
      AI_API_KEY: '',
    });
    const {env} = loadLocalConfig('missing.env');
    assert.equal(env.AI_ENABLED, '1');
    assert.equal(env.AI_BASE_URL, 'http://127.0.0.1:11434/v1');
    assert.equal(env.AI_MODEL, 'qwen3:4b-instruct');
  } finally {
    for (const key of keys) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
});

test('the AI route re-reads the style file on every summary', async () => {
  const {createAiApi} = await import('../server/ai-api.js');
  let style = 'Giọng A.';
  const sent = [];
  const api = createAiApi({
    env: {AI_STYLE_FILE: 'F:/style.md'},
    readFileImpl: async () => style,
    fetchImpl: async (url, options) => {
      sent.push(JSON.parse(options.body).messages[0].content);
      return fakeModel();
    },
  });
  const call = () =>
    api(
      new Request('http://127.0.0.1/api/ai/summary', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({facts}),
      }),
    );
  assert.equal((await call()).status, 200);
  style = 'Giọng B.';
  await call();
  assert.match(sent[0], /Giọng A\./);
  assert.match(sent[1], /Giọng B\./);
});
