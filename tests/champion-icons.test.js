import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, readdir} from 'node:fs/promises';
import {championIconPath, championAvatar} from '../public/champion-icons.js';

test('champion icons match Riot IDs, display names and punctuation variants', () => {
  for (const [name, slug] of [
    ['Ahri', 'ahri'], ['  aHrI  ', 'ahri'], ['Aurelion Sol', 'aurelionsol'],
    ["Kai'Sa", 'kaisa'], ['Kai’Sa', 'kaisa'], ['Kaisa', 'kaisa'],
    ['Nunu', 'nunuwillump'], ['Nunu & Willump', 'nunuwillump'],
    ['MonkeyKing', 'wukong'], ['Wukong', 'wukong'],
    ['Renata', 'renataglasc'], ['Renata Glasc', 'renataglasc'],
    ['Dr. Mundo', 'drmundo'], ['DrMundo', 'drmundo'],
    ['FiddleSticks', 'fiddlesticks'], ["Cho'Gath", 'chogath'],
    ['JarvanIV', 'jarvaniv'], ['LeBlanc', 'leblanc'],
  ]) assert.equal(championIconPath(name), '/champions/' + slug + '.png', name);
});

test('unknown and unsafe champion names use escaped text without remote image requests', () => {
  for (const name of ['Unknown Champion', '', null, '__proto__', 'constructor', '<img src=x onerror=alert(1)>']) {
    assert.equal(championIconPath(name), null);
    assert.ok(!championAvatar(name).includes('<img'));
  }
  const html = championAvatar('<script>');
  assert.ok(html.includes('&lt;S'));
  assert.ok(!html.includes('<script>'));
});

test('known champion avatar keeps fallback text and decorative accessible image', () => {
  const html = championAvatar('Ahri', true);
  assert.match(html, /small-avatar/);
  assert.match(html, /src="\/champions\/ahri.png"/);
  assert.match(html, /alt=""/);
  assert.match(html, /aria-hidden="true"/);
  assert.match(html, /champion-initials/);
  assert.match(html, />AH<\/span>/);
  assert.ok(!html.includes('onerror='));
});

test('every mapped champion icon is a real bundled PNG with the expected dimensions', async () => {
  const root = new URL('../public/champions/', import.meta.url);
  const names = await readdir(root);
  assert.ok(names.length > 160);
  for (const file of names) {
    assert.equal(championIconPath(file.replace('.png', '')), '/champions/' + file);
    const bytes = await readFile(new URL(file, root));
    assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    assert.equal(bytes.readUInt32BE(16), 128, file);
    assert.equal(bytes.readUInt32BE(20), 128, file);
  }
});
