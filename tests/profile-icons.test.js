import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeHistory, sampleHistory, exportHistory} from '../public/history-data.js';
import {saveHistorySnapshot, loadSavedHistory, mergeHistoryPage} from '../public/history-store.js';
import {renderProfileAvatar} from '../public/profile-view.js';
import {loadProfileIcon, PROFILE_ICON_PATCH} from '../server/riot.js';
import {handleApi} from '../server/worker.js';

const png = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
test('profile icon survives JSON, saved history and a merge without a new icon', () => {
  const history = sampleHistory('mayhem');
  history.profile.profileIconId = 685;
  assert.equal(normalizeHistory(exportHistory(history)).profile.profileIconId, 685);
  let saved;
  const storage = {
    getItem: () => saved,
    setItem: (key, value) => {
      saved = value;
    },
  };
  assert.equal(saveHistorySnapshot(history, null, storage).ok, true);
  assert.equal(loadSavedHistory(storage).history.profile.profileIconId, 685);
  const incoming = structuredClone(history);
  incoming.profile.region = history.profile.region = 'OCE';
  delete incoming.profile.profileIconId;
  assert.equal(mergeHistoryPage(history, incoming).profile.profileIconId, 685);
  incoming.profile.profileIconId = 0;
  assert.equal(mergeHistoryPage(history, incoming).profile.profileIconId, 0);
});

test('old profiles keep their fallback; icon IDs cannot be URLs or paths', () => {
  const history = sampleHistory();
  assert.doesNotMatch(renderProfileAvatar(history.profile), /<img/);
  assert.match(renderProfileAvatar({...history.profile, profileIconId: 0}), /\/api\/profile-icon\/0.png/);
  assert.match(renderProfileAvatar({riotId: '<x'}), /&lt;X/);
  for (const id of [-1, 1.2, '685', 'https://evil.test', 1000000]) {
    assert.throws(() => normalizeHistory({...history, profile: {...history.profile, profileIconId: id}}));
    assert.doesNotMatch(renderProfileAvatar({...history.profile, profileIconId: id}), /<img/);
  }
});

test('icon fetch uses only the official host and never sends credentials', async () => {
  const response = await loadProfileIcon(685, async (url, options) => {
    assert.equal(
      url,
      `https://ddragon.leagueoflegends.com/cdn/${PROFILE_ICON_PATCH}/img/profileicon/685.png`,
    );
    assert.equal(options.headers, undefined);
    assert.equal(options.redirect, 'error');
    return new Response(png, {headers: {'Content-Type': 'image/png'}});
  });
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), png);
  assert.equal(response.headers.get('Content-Type'), 'image/png');
  await assert.rejects(loadProfileIcon('../685'), {code: 'INVALID_ICON'});
  await assert.rejects(
    loadProfileIcon(685, async () => new Response('', {status: 404})),
    {code: 'ICON_NOT_FOUND'},
  );
  for (const response of [
    new Response('<svg/>', {headers: {'Content-Type': 'image/png'}}),
    new Response(new Uint8Array(512 * 1024 + 1), {headers: {'Content-Type': 'image/png'}}),
    new Response(png, {headers: {'Content-Type': 'text/html'}}),
  ])
    await assert.rejects(
      loadProfileIcon(685, async () => response),
      {code: 'ICON_UNAVAILABLE'},
    );
});

test('icon endpoint requires access, validates paths, returns PNG without a Riot key', async () => {
  let calls = 0;
  const options = {
    fetchImpl: async () => {
      calls++;
      return new Response(png, {headers: {'Content-Type': 'image/png'}});
    },
  };
  const url = 'https://app.test/api/profile-icon/685.png';
  assert.equal((await handleApi(new Request(url), {}, options)).status, 401);
  const headers = {'oai-authenticated-user-id': 'test'};
  assert.equal((await handleApi(new Request(url, {method: 'POST', headers}), {}, options)).status, 405);
  assert.equal((await handleApi(new Request(url.replace('685', 'abc'), {headers}), {}, options)).status, 400);
  assert.equal(calls, 0);
  const response = await handleApi(new Request(url, {headers}), {}, options);
  assert.equal(response.status, 200);
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), png);
  assert.equal(calls, 1);
});
