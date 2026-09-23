import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, readFile, copyFile, symlink, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createLocalServer} from '../server/local.js';

const exec = promisify(execFile);
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j5eUAAAAASUVORK5CYII=', 'base64');

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'rift-assets-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  await mkdir(join(root, 'public/champions'), {recursive: true});
  await writeFile(join(root, 'public/index.html'), '<h1>Fixture</h1>');
  await writeFile(join(root, 'public/champions/Ahri.png'), png);
  for (const folder of ['items', 'spells', 'runes', 'ranks']) {
    await mkdir(join(root, 'public', folder));
    await writeFile(join(root, 'public', folder, '1001.png'), png);
  }
  await writeFile(join(root, '.env'), 'private-fixture');
  return root;
}

async function assertPng(response, method) {
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'image/png');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), method === 'HEAD' ? Buffer.alloc(0) : png);
}

test('local serves exact champion PNG bytes and HEAD while rejecting nested private files and symlinks', async t => {
  const root = await fixture(t);
  await symlink(join(root, '.env'), join(root, 'public/champions/Linked.png'));
  await writeFile(join(root, 'public/.env'), 'private-fixture');
  await symlink(join(root, 'public/.env'), join(root, 'public/champions/Internal.png'));
  const server = createLocalServer({publicDirectory: join(root, 'public')});
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const origin = `http://127.0.0.1:${server.address().port}`;
  for (const method of ['GET', 'HEAD']) {
    const response = await fetch(origin + '/champions/Ahri.png', {method});
    assert.equal(response.headers.get('content-length'), String(png.length));
    await assertPng(response, method);
  }
  for (const path of ['/.env', '/champions/.env', '/champions/%2e%2e%2f.env', '/champions/Linked.png', '/champions/Internal.png', '/champions/sub/Ahri.png']) {
    const response = await fetch(origin + path);
    assert.equal(response.status, 404, path);
    assert.ok(!(await response.text()).includes('private-fixture'));
  }
});

async function buildFixture(root) {
  await mkdir(join(root, 'server'), {recursive: true});
  await mkdir(join(root, '.openai'), {recursive: true});
  await Promise.all(['build.mjs', 'server/riot.js', 'server/worker.js', '.openai/hosting.json'].map(file =>
    copyFile(new URL('../' + file, import.meta.url), join(root, file))));
  await writeFile(join(root, 'package.json'), '{"type":"module"}');
  return exec(process.execPath, ['build.mjs'], {cwd: root});
}

test('built Worker returns exact champion PNG bytes and HEAD without weakening API authentication', async t => {
  const root = await fixture(t);
  await buildFixture(root);
  const {default: worker} = await import(pathToFileURL(join(root, 'dist/server/index.js')).href);
  for (const method of ['GET', 'HEAD']) {
    await assertPng(await worker.fetch(new Request('https://fixture.test/champions/Ahri.png', {method}), {}), method);
  }
  const html = await worker.fetch(new Request('https://fixture.test/'), {});
  assert.equal(await html.text(), '<h1>Fixture</h1>');
  for (const path of ['/.env', '/champions/.env', '/champions/%2e%2e%2f.env', '/champions/sub/Ahri.png']) {
    assert.equal((await worker.fetch(new Request('https://fixture.test' + path), {})).status, 404);
  }
  assert.equal((await worker.fetch(new Request('https://fixture.test/api/status'), {})).status, 401);
  assert.equal((await worker.fetch(new Request('https://fixture.test/champions/Ahri.png', {method: 'POST'}), {})).status, 405);
  assert.ok(!(await readFile(join(root, 'dist/server/index.js'), 'utf8')).includes('private-fixture'));
});

test('build rejects symlinked champion assets rather than embedding files outside public', async t => {
  const root = await fixture(t);
  await symlink(join(root, '.env'), join(root, 'public/champions/Linked.png'));
  await assert.rejects(buildFixture(root), /Unsupported public asset/);
});


test('local serves all game icon categories and rejects nested paths and symlinks', async t => {
  const root = await fixture(t);
  const server = createLocalServer({publicDirectory: join(root, 'public')});
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const origin = `http://127.0.0.1:${server.address().port}`;
  for (const folder of ['items', 'spells', 'runes', 'ranks']) {
    for (const method of ['GET', 'HEAD']) await assertPng(await fetch(`${origin}/${folder}/1001.png`, {method}), method);
    await symlink(join(root, '.env'), join(root, 'public', folder, 'Linked.png'));
    for (const path of ['Linked.png', 'sub/1001.png', '%2e%2e%2f.env']) {
      assert.equal((await fetch(`${origin}/${folder}/${path}`)).status, 404);
    }
  }
});

test('build preserves game icon bytes and rejects symlinked game icons', async t => {
  const root = await fixture(t);
  await buildFixture(root);
  const {default: worker} = await import(pathToFileURL(join(root, 'dist/server/index.js')).href);
  for (const folder of ['items', 'spells', 'runes', 'ranks']) {
    for (const method of ['GET', 'HEAD']) await assertPng(await worker.fetch(new Request(`https://fixture.test/${folder}/1001.png`, {method}), {}), method);
    await symlink(join(root, '.env'), join(root, 'public', folder, 'Linked.png'));
    await assert.rejects(buildFixture(root), /Unsupported public asset/);
    await rm(join(root, 'public', folder, 'Linked.png'));
  }
});

test('game asset manifest maps supported IDs to existing local PNGs and rejects unknown input', async () => {
  const {gameAsset} = await import('../public/game-assets.js');
  for (const [kind, id, folder] of [
    ['item', 1001, 'items'], ['item', 3364, 'items'], ['spell', 4, 'spells'],
    ['spell', 12, 'spells'], ['rune', 8000, 'runes'], ['rune', 8010, 'runes'],
    ['rune', 5008, 'runes'], ['rune', 5013, 'runes'], ['rank', 'GOLD', 'ranks'],
  ]) {
    const asset = gameAsset(kind, id);
    assert.ok(asset?.name);
    assert.equal(asset.src, `/${folder}/${id}.png`);
    assert.ok(Object.isFrozen(asset));
    assert.deepEqual((await readFile(new URL('../public' + asset.src, import.meta.url))).subarray(0, 8), png.subarray(0, 8));
  }
  for (const kind of ['item', 'spell', 'rune', 'rank']) {
    for (const id of [null, undefined, -1, {}, '../.env', 'constructor', '__proto__']) {
      assert.equal(gameAsset(kind, id), null);
    }
  }
  assert.equal(gameAsset('constructor', 1), null);
  assert.equal(gameAsset('unknown', 1), null);
  assert.deepEqual(gameAsset('rank', 'gold'), gameAsset('rank', 'GOLD'));
});
