import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {gameAsset} from '../public/game-assets.js';

test('asset names follow the selected locale without changing icon URLs', () => {
  for (const [kind, id, english] of [['item', 1001, 'Boots'], ['spell', 4, 'Flash'], ['rune', 8010, 'Conqueror'], ['rune', 5008, 'Adaptive Force'], ['rank', 'GOLD', 'Gold']]) {
    const vi = gameAsset(kind, id, 'vi');
    const en = gameAsset(kind, id, 'en');
    assert.equal(en.name, english);
    assert.equal(en.src, vi.src);
    assert.ok(Object.isFrozen(en));
    assert.deepEqual(gameAsset(kind, id), vi);
    assert.deepEqual(gameAsset(kind, id, 'unsupported'), vi);
  }
  assert.equal(gameAsset('item', '__proto__', 'en'), null);
});

test('vendored item images have exact source URLs and hashes, including current wiki icons', async () => {
  const manifest = JSON.parse(await readFile(new URL('../scripts/item-icon-sources.json', import.meta.url), 'utf8'));
  assert.equal(manifest.metadataVersion, '16.18.1');
  assert.equal(manifest.page, 'https://wiki.leagueoflegends.com/en-us/Item');
  for (const id of ['1001', '3031', '3153', '2422']) {
    assert.equal(manifest.items[id].provider, 'League of Legends Wiki');
    assert.match(manifest.items[id].url, /^https:\/\/wiki\.leagueoflegends\.com\/en-us\/images\/[^/]+\.png\?/);
  }
  for (const [id, record] of Object.entries(manifest.items)) {
    const data = await readFile(new URL(`../public/items/${id}.png`, import.meta.url));
    assert.equal(createHash('sha256').update(data).digest('hex'), record.sha256, id);
    assert.match(record.url, /^https:\/\/(wiki\.leagueoflegends\.com|ddragon\.leagueoflegends\.com)\//);
    if (record.provider === 'Riot Data Dragon') assert.ok(record.reason);
  }
});
