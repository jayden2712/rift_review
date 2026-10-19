// Synthetic timeline/collection browser regression. No .env and no live Riot requests.
import assert from 'node:assert/strict';
import {mkdtemp, rm, readFile, readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createLocalServer} from '../../server/local.js';
import {timelineFixture, matchFixture} from '../fixtures/lab-timeline.js';
const {chromium} = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const directory = await mkdtemp(join(tmpdir(), 'rift-timeline-e2e-'));
const calls = [];
let denyTimeline = true,
  retryDetail = false;
const timeline = timelineFixture();
timeline.extension = {uninterpreted: [0, false, null]};
timeline.info.frames[3].events = [
  {type: 'ELITE_MONSTER_KILL', timestamp: 850000, killerId: 2, monsterType: 'DRAGON'},
];
const server = createLocalServer({
  env: {DATA_LAB_ENABLED: '1', RIOT_API_KEY: 'fixture-only'},
  labDirectory: directory,
  fetchImpl: async address => {
    const url = new URL(address);
    calls.push(url.pathname);
    if (url.pathname.includes('/accounts/'))
      return Response.json({puuid: 'player', gameName: 'Timeline', tagLine: 'TEST'});
    if (url.pathname.includes('/summoner/')) return Response.json({});
    if (url.pathname.endsWith('/ids')) return Response.json(['OC1_99', 'OC1_100', 'OC1_101']);
    if (url.pathname.endsWith('/timeline'))
      return denyTimeline ? new Response('', {status: 403}) : Response.json(timeline);
    const id = url.pathname.split('/').at(-1);
    if (id === 'OC1_100' && !retryDetail) return new Response('', {status: 404});
    const match = matchFixture();
    match.metadata.matchId = id;
    match.info.gameStartTimestamp = Date.UTC(2026, 9, 1) - Number(id.split('_')[1]) * 3600000;
    return Response.json(match);
  },
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({headless: true, args: ['--no-sandbox']});
try {
  const page = await browser.newPage({viewport: {width: 1440, height: 1050}}),
    errors = [];
  page.setDefaultTimeout(10000);
  page.on('pageerror', error => errors.push(error.message));
  const idle = () =>
    page.waitForFunction(() => !document.querySelector('#data-lab').hasAttribute('aria-busy'));
  const exportJSON = async selector => {
    const download = page.waitForEvent('download');
    await page.locator(selector).click();
    return JSON.parse(await readFile(await (await download).path(), 'utf8'));
  };
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.locator('#open-data-lab').click();
  assert.equal(calls.length, 0);
  await page.locator('#lab-riot-form [name=riotId]').fill('Timeline#TEST');
  await page.locator('#lab-riot-form').evaluate(form => form.requestSubmit());
  await idle();
  assert.equal(await page.locator('[data-lab-row]').count(), 2);
  assert.equal(calls.filter(path => path.endsWith('/timeline')).length, 0);
  assert.match(await page.locator('#lab-collection-status').innerText(), /OC1_100/);
  const before = await exportJSON('#lab-export-coaching');
  await page.locator('[data-lab-sort=kda]').click();
  assert.deepEqual(await exportJSON('#lab-export-coaching'), before);
  const initialID = await page.locator('#lab-saved-list').inputValue();
  const originalBytes = await readFile(join(directory, initialID + '.json'), 'utf8');
  await page.locator('[data-lab-match="OC1_99"]').click();
  await page.locator('[data-lab-timeline="OC1_99"]').click();
  await idle();
  assert.match(await page.locator('#lab-error').innerText(), /từ chối/);
  assert.equal(calls.filter(path => path.endsWith('/timeline')).length, 1);
  assert.equal((await readdir(directory)).length, 1);
  denyTimeline = false;
  await page.locator('[data-lab-timeline="OC1_99"]').click();
  await idle();
  assert.equal(calls.filter(path => path.endsWith('/timeline')).length, 2);
  assert.equal(await page.locator('.lab-timeline-checkpoints tbody tr').count(), 3);
  assert.equal(await page.locator('.lab-timeline-chart svg').count(), 2);
  assert.match(await page.locator('.lab-timeline-checkpoints').innerText(), /09m30s|9:30/);
  assert.equal(await page.locator('.lab-timeline-events li').count(), 2);
  await page.locator('[data-lab-player-events]').uncheck();
  assert.equal(await page.locator('.lab-timeline-events li').count(), 3);
  await page.locator('[data-language=en]').click();
  const exported = await exportJSON('#lab-export');
  const loaded = exported.records.find(record => record.matchId === 'OC1_99');
  assert.deepEqual(loaded.timeline.raw, timeline);
  const coaching = await exportJSON('#lab-export-coaching');
  assert.ok(
    coaching.findings.some(
      finding =>
        finding.topic === 'timeline' || finding.evidence.some(evidence => evidence.kind === 'player_death'),
    ),
  );
  assert.ok(!JSON.stringify(coaching).includes('uninterpreted'));
  await page.route('**/api/lab/timeline', route =>
    route.fulfill({
      status: 504,
      contentType: 'application/json',
      body: JSON.stringify({error: {code: 'RIOT_TIMEOUT', message: 'Riot phản hồi quá lâu.'}}),
    }),
  );
  await page.locator('[data-lab-timeline="OC1_99"]').click();
  await idle();
  const afterTimeout = (await exportJSON('#lab-export')).records.find(
    record => record.matchId === 'OC1_99',
  ).timeline;
  assert.deepEqual(afterTimeout.raw, timeline);
  assert.equal(afterTimeout.status, 'error');
  assert.equal(afterTimeout.lastError.code, 'RIOT_TIMEOUT');
  assert.ok(afterTimeout.lastAttemptAt);
  assert.equal(await page.locator('.lab-timeline-checkpoints tbody tr').count(), 3);
  await page.unroute('**/api/lab/timeline');
  // A failed saved-list refresh must not relabel a successful timeline load as failed.
  await page.route('**/api/lab/snapshots', route =>
    route.request().method() === 'GET'
      ? route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({error: {code: 'LAB_STORAGE_ERROR'}}),
        })
      : route.continue(),
  );
  await page.locator('[data-lab-timeline="OC1_99"]').click();
  await idle();
  const afterListFailure = (await exportJSON('#lab-export')).records.find(
    record => record.matchId === 'OC1_99',
  ).timeline;
  assert.equal(afterListFailure.status, 'loaded');
  assert.equal(afterListFailure.lastError, null);
  assert.match(await page.locator('#lab-status').innerText(), /dataset was updated/);
  await page.unroute('**/api/lab/snapshots');
  await page.locator('#lab-refresh-list').click();
  await idle();
  assert.equal(await readFile(join(directory, initialID + '.json'), 'utf8'), originalBytes);
  await page.locator('#lab-load').click();
  await idle();
  assert.deepEqual(
    (await exportJSON('#lab-export')).records.find(record => record.matchId === 'OC1_99').timeline.raw,
    timeline,
  );
  await page.locator('#lab-import-box summary').click();
  await page.locator('#lab-import-json').fill(JSON.stringify(exported));
  await page.locator('#lab-import').click();
  await idle();
  const imported = await exportJSON('#lab-export');
  assert.equal(imported.source, 'imported');
  assert.equal(imported.records.find(record => record.matchId === 'OC1_99').timeline.provenance, 'imported');
  assert.deepEqual(imported.records.find(record => record.matchId === 'OC1_99').timeline.raw, timeline);
  retryDetail = true;
  await page.locator('[data-lab-retry]').click();
  await idle();
  assert.equal(await page.locator('[data-lab-row]').count(), 3);
  await page.locator('[data-lab-match="OC1_99"]').click();
  await page.locator('#lab-import-box summary').click();
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({width, height: 950});
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true,
      `overflow at ${width}`,
    );
  }
  await page.locator('[data-lab-timeline-section]').scrollIntoViewIfNeeded();
  await page.screenshot({path: '/tmp/rift-timeline-mobile.png'});
  await page.setViewportSize({width: 1440, height: 1050});
  await page.locator('[data-lab-timeline-section]').scrollIntoViewIfNeeded();
  await page.screenshot({path: '/tmp/rift-timeline-desktop.png'});
  assert.deepEqual(errors, []);
  console.log(
    'PASS: fixture partial collection/retry, sort-stable coaching JSON, timeline 403/retry/load/timeout retention, raw/filtered events/checkpoints/charts, snapshot disk/export/import, VI/EN and mobile; no live Riot verification.',
  );
} finally {
  await browser.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  await rm(directory, {recursive: true, force: true});
}
