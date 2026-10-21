import test from 'node:test';
import assert from 'node:assert/strict';
import {buildAiFacts, renderAiPanel, requestAiSummary} from '../public/ai-summary.js';
import {setLanguage} from '../public/i18n.js';

const report = {
  stats: {n: 20, wins: 13},
  history: {profile: {riotId: 'not tày enough#idc', region: 'OCE'}},
  comparison: {
    coverage: {withDetail: 20, total: 20},
    lane: {
      matches: 20,
      metrics: [
        {
          id: 'csPerMin',
          higherIsBetter: true,
          total: 19,
          ahead: 5,
          behind: 14,
          you: 6.63,
          opponent: 7.01,
          consistentlyAhead: false,
          consistentlyBehind: true,
        },
        {
          id: 'kp',
          higherIsBetter: true,
          total: 20,
          ahead: 13,
          behind: 7,
          you: 0.55,
          opponent: 0.43,
          consistentlyAhead: true,
          consistentlyBehind: false,
        },
      ],
    },
    self: {available: false},
    winLoss: {
      available: true,
      wins: 13,
      losses: 7,
      metrics: [
        {
          id: 'timeDeadShare',
          higherIsBetter: false,
          win: 0.05,
          loss: 0.1,
          effect: -1,
          notable: true,
          favorsWins: true,
        },
      ],
    },
  },
  championComparison: [
    {champion: 'TwistedFate', games: 5, wins: 4, kda: 3.46, csDiffPerMin: -1.28, goldDiffPerMin: -12.4},
  ],
};

test('facts are compact, pre-formatted and never contain Riot IDs', () => {
  const facts = buildAiFacts(report, 'vi');
  const text = JSON.stringify(facts);
  assert.equal(facts.language, 'vi');
  assert.equal(facts.games, 20);
  assert.doesNotMatch(text, /not tày enough|#idc/);
  assert.match(text, /6,6/);
  assert.match(text, /14\/19/);
  assert.deepEqual(facts.laneAhead, [
    'Tham gia hạ gục: bạn 55%, đối thủ cùng đường 43%; bạn hơn ở 13/20 trận.',
  ]);
  assert.deepEqual(facts.winsVsLosses, [
    '% thời gian chết: 5% trong các trận thắng, 10% trong các trận thua.',
  ]);
  assert.equal(
    facts.champions[0],
    'TwistedFate: 5 trận, thắng 4; CS/phút so với đối thủ −1,3; vàng/phút so với đối thủ −12.',
  );
  assert.equal(buildAiFacts({...report, comparison: null}, 'vi'), null);
});

test('panel shows the button, progress, errors and an escaped grounded result', () => {
  assert.equal(renderAiPanel({enabled: false}), '');
  assert.match(
    renderAiPanel({enabled: true, model: 'qwen3:4b-instruct', state: {kind: 'idle'}}),
    /data-ai-summary/,
  );
  assert.match(renderAiPanel({enabled: true, model: 'm', state: {kind: 'loading'}}), /aria-busy="true"/);
  assert.match(
    renderAiPanel({enabled: true, model: 'm', state: {kind: 'error', message: 'Ollama tắt'}}),
    /Ollama tắt/,
  );
  const html = renderAiPanel({
    enabled: true,
    model: 'm',
    state: {
      kind: 'done',
      result: {
        summary: 'Bạn <b>kém</b> CS.',
        focus: [{title: 'Farm', why: '6,6 so với 7,0', drill: 'Ăn đủ wave.'}],
        removed: 1,
        model: 'qwen3:4b-instruct',
      },
    },
  });
  assert.match(html, /Bạn &lt;b&gt;kém&lt;\/b&gt; CS\./);
  assert.match(html, /Ăn đủ wave/);
  assert.match(html, /qwen3:4b-instruct/);
  assert.match(html, /1 câu/);
  assert.match(html, /data-ai-summary/);
});

test('requests post the facts and surface server errors in the current language', async () => {
  let sent;
  const ok = await requestAiSummary(
    {a: 1},
    {
      fetchImpl: async (path, options) => {
        sent = {path, options};
        return Response.json({summary: 's', focus: [], removed: 0, model: 'm'});
      },
    },
  );
  assert.equal(sent.path, '/api/ai/summary');
  assert.deepEqual(JSON.parse(sent.options.body), {facts: {a: 1}});
  assert.equal(ok.summary, 's');
  setLanguage('en');
  try {
    await assert.rejects(
      requestAiSummary(
        {},
        {
          fetchImpl: async () =>
            Response.json({error: {code: 'AI_UNAVAILABLE', message: 'x'}}, {status: 503}),
        },
      ),
      error => /Ollama/.test(error.message),
    );
  } finally {
    setLanguage('vi');
  }
  await assert.rejects(
    requestAiSummary(
      {},
      {
        fetchImpl: async () => {
          throw new TypeError('offline');
        },
      },
    ),
    error => /máy chủ/.test(error.message),
  );
});
