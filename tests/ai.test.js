import test from 'node:test';
import assert from 'node:assert/strict';
import {aiConfig, groundAnswer, validateFacts, requestSummary} from '../server/ai.js';

const facts = {
  language: 'vi',
  games: 20,
  takeaways: ['Bạn kém đối thủ cùng đường về CS / phút ở 14/19 trận (6,6 so với 7,0).'],
  laneBehind: [{metric: 'CS / phút', you: '6,6', opponent: '7,0', games: '14/19'}],
  champions: [{champion: 'Jayce', games: 5, wins: 5, goldDiffPerMin: '+128'}],
};

test('config defaults to local Ollama and only accepts http(s) URLs', () => {
  assert.deepEqual(aiConfig({}), {
    baseUrl: 'http://127.0.0.1:11434/v1',
    model: 'qwen3:4b-instruct',
    apiKey: '',
  });
  assert.equal(
    aiConfig({AI_BASE_URL: 'https://openrouter.ai/api/v1/', AI_MODEL: 'x/y'}).baseUrl,
    'https://openrouter.ai/api/v1',
  );
  assert.throws(() => aiConfig({AI_BASE_URL: 'file:///etc/passwd'}), {code: 'AI_CONFIG'});
  assert.throws(() => aiConfig({AI_BASE_URL: 'not a url'}), {code: 'AI_CONFIG'});
});

test('facts must be a small object of strings, numbers and nested lists without Riot IDs', () => {
  assert.deepEqual(validateFacts(facts), facts);
  for (const bad of [
    null,
    [],
    'x',
    {a: () => 1},
    {big: 'x'.repeat(20000)},
    {player: 'Name#TAG'},
    {a: {b: {c: {d: {e: {}}}}}},
  ])
    assert.throws(() => validateFacts(bad), {code: 'AI_INVALID_FACTS'});
});

test('grounding removes sentences and focus items with numbers that are not in the facts', () => {
  const answer = {
    summary: 'Bạn kém đối thủ về CS ở 14/19 trận. Bạn thắng 87% trận gần đây. Jayce là tướng mạnh nhất.',
    focus: [
      {title: 'CS / phút', why: '6,6 so với 7,0 của đối thủ.', drill: 'Xem lại wave trước khi về nhà.'},
      {title: 'Vàng', why: 'Bạn hơn 300 vàng mỗi phút.', drill: 'Giữ nhịp.'},
    ],
  };
  const {summary, focus, removed} = groundAnswer(answer, facts);
  assert.equal(summary, 'Bạn kém đối thủ về CS ở 14/19 trận. Jayce là tướng mạnh nhất.');
  assert.equal(focus.length, 1);
  assert.equal(focus[0].title, 'CS / phút');
  assert.equal(removed, 2);
  // Small counts and numbers written with the other decimal separator are accepted.
  assert.equal(groundAnswer({summary: 'Tập 2 thói quen, CS 6.6.', focus: []}, facts).removed, 0);
  // Percentages and decimals are never exempt, even when small.
  assert.equal(groundAnswer({summary: 'Bạn chết 6% thời gian.', focus: []}, facts).removed, 1);
  assert.equal(groundAnswer({summary: 'CS của bạn là 6.9.', focus: []}, facts).removed, 1);
});

test('requestSummary calls an OpenAI-compatible endpoint with a JSON schema and grounds the result', async () => {
  let sent;
  const fetchImpl = async (url, options) => {
    sent = {url, options, body: JSON.parse(options.body)};
    return Response.json({
      model: 'qwen3:4b-instruct',
      choices: [
        {
          message: {
            content: JSON.stringify({
              summary: 'Bạn kém CS ở 14/19 trận. Bạn có 99 mạng.',
              focus: [{title: 'Farm', why: '6,6 so với 7,0.', drill: 'Ăn đủ wave.'}],
            }),
          },
        },
      ],
    });
  };
  const result = await requestSummary(facts, {config: aiConfig({AI_API_KEY: 'k'}), fetchImpl});
  assert.equal(sent.url, 'http://127.0.0.1:11434/v1/chat/completions');
  assert.equal(sent.options.headers.Authorization, 'Bearer k');
  assert.equal(sent.body.model, 'qwen3:4b-instruct');
  assert.equal(sent.body.response_format.type, 'json_schema');
  assert.match(sent.body.messages[1].content, /14\/19/);
  assert.equal(result.summary, 'Bạn kém CS ở 14/19 trận.');
  assert.equal(result.removed, 1);
  assert.equal(result.model, 'qwen3:4b-instruct');
});

test('requestSummary maps transport and output failures to explicit errors', async () => {
  const config = aiConfig({});
  const refused = async () => {
    throw Object.assign(new TypeError('fetch failed'), {cause: {code: 'ECONNREFUSED'}});
  };
  await assert.rejects(requestSummary(facts, {config, fetchImpl: refused}), {code: 'AI_UNAVAILABLE'});
  const http = async () => new Response('model not found', {status: 404});
  await assert.rejects(requestSummary(facts, {config, fetchImpl: http}), {code: 'AI_UPSTREAM'});
  const garbage = async () => Response.json({choices: [{message: {content: 'not json'}}]});
  await assert.rejects(requestSummary(facts, {config, fetchImpl: garbage}), {code: 'AI_BAD_OUTPUT'});
  const wrongShape = async () => Response.json({choices: [{message: {content: '{"summary": 5}'}}]});
  await assert.rejects(requestSummary(facts, {config, fetchImpl: wrongShape}), {code: 'AI_BAD_OUTPUT'});
});
