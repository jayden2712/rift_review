import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, readFile, readdir, rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {desktopConfig, initializeDesktopData, importDesktopConfig} from '../desktop/config.js';
import {startDesktopServer, isAppUrl} from '../desktop/runtime.js';

async function temporary(t) {
  const root = await mkdtemp(join(tmpdir(), 'rift-desktop-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  return root;
}

test('desktop config isolates environment, has a stable origin and writable data paths', () => {
  const previous = process.env.RIFT_DESKTOP_UNTRUSTED;
  const config = desktopConfig(
    'RIOT_API_KEY=fixture-secret\nLCU_ENABLED=1\nAI_ENABLED=true\nPORT=9999\nRIFT_DESKTOP_UNTRUSTED=changed\nAI_STYLE_FILE=style.md',
    tmpdir(),
  );
  assert.equal(config.port, 4179, 'web PORT must not change the desktop storage origin');
  assert.equal(config.env.LCU_ENABLED, '1');
  assert.equal(config.env.AI_ENABLED, '0');
  assert.equal(config.env.AI_STYLE_FILE, join(tmpdir(), 'style.md'));
  assert.equal(config.labDirectory, join(tmpdir(), '.local', 'data-lab'));
  assert.equal(config.env.RIFT_DESKTOP_UNTRUSTED, undefined);
  assert.equal(process.env.RIFT_DESKTOP_UNTRUSTED, previous);
  for (const value of ['0', '1023', '65536', '1.5', 'fixture-secret']) {
    assert.throws(
      () => desktopConfig(`DESKTOP_PORT=${value}`, tmpdir()),
      error => /DESKTOP_PORT/.test(error.message) && !error.message.includes('fixture-secret'),
    );
  }
  assert.equal(desktopConfig('DESKTOP_PORT=4189', tmpdir()).port, 4189);
});

test('first launch imports existing settings, style and Data Lab without packaging or overwriting them', async t => {
  const root = await temporary(t);
  const source = join(root, 'source'),
    destination = join(root, 'desktop');
  await mkdir(join(source, '.local', 'data-lab'), {recursive: true});
  await writeFile(
    join(source, '.env'),
    'RIOT_API_KEY=fixture-secret\nLCU_ENABLED=1\nAI_ENABLED=1\nDATA_LAB_ENABLED=1\n',
  );
  await writeFile(join(source, '.local', 'ai-style.md'), 'A personal style.');
  const snapshotName = '00000000-0000-4000-8000-000000000001.json';
  await writeFile(join(source, '.local', 'data-lab', snapshotName), '{"fixture":true}');
  await writeFile(join(source, '.local', 'data-lab', 'unrelated.txt'), 'private unrelated file');
  const options = {userData: destination, importFile: join(source, '.env')};
  const config = await initializeDesktopData(options);
  assert.equal(config.env.RIOT_API_KEY, 'fixture-secret');
  assert.equal(config.env.AI_ENABLED, '1');
  assert.equal(config.env.DATA_LAB_ENABLED, '1');
  assert.equal(await readFile(config.env.AI_STYLE_FILE, 'utf8'), 'A personal style.');
  assert.deepEqual(await readdir(config.labDirectory), [snapshotName]);
  await writeFile(join(source, '.env'), 'RIOT_API_KEY=different\n');
  assert.equal((await initializeDesktopData(options)).env.RIOT_API_KEY, 'fixture-secret');
  await importDesktopConfig(join(source, '.env'), destination, {overwrite: true});
  assert.match(await readFile(join(destination, '.env'), 'utf8'), /different/);
  const backup = (await readdir(destination)).find(name => name.startsWith('.env.backup-'));
  assert.match(await readFile(join(destination, backup), 'utf8'), /fixture-secret/);
  assert.equal(await readFile(join(source, '.env'), 'utf8'), 'RIOT_API_KEY=different\n');
});

test('new installs use the bundled template and preserve subsequent edits', async t => {
  const root = await temporary(t);
  const userData = join(root, 'data');
  const options = {userData, templateFile: new URL('../desktop/default.env', import.meta.url)};
  assert.equal((await initializeDesktopData(options)).env.LCU_ENABLED, '1');
  await writeFile(join(userData, '.env'), 'LCU_ENABLED=0\n');
  assert.equal((await initializeDesktopData(options)).env.LCU_ENABLED, '0');
});

test('desktop backend preserves UI, assets, API security and optional modules; closing releases the port', async t => {
  const root = await temporary(t);
  const backend = await startDesktopServer({
    port: 0,
    env: {AI_ENABLED: '1', LCU_ENABLED: '1', DATA_LAB_ENABLED: '1'},
    labDirectory: root,
  });
  t.after(() => backend.close());
  const html = await fetch(backend.origin).then(r => r.text());
  assert.match(html, /stats-charts/);
  assert.equal((await fetch(backend.origin + '/api/status')).status, 200);
  assert.equal((await fetch(backend.origin + '/api/lab/status')).status, 200);
  assert.equal((await fetch(backend.origin + '/api/ai/status')).status, 200);
  assert.equal(
    (await fetch(backend.origin + '/api/status', {headers: {Origin: 'https://untrusted.test'}})).status,
    403,
  );
  assert.equal((await fetch(backend.origin + '/.env')).status, 404);
  assert.equal((await fetch(backend.origin + '/data-lab-model.js')).status, 200);
  assert.equal(
    (await fetch(backend.origin + '/champions/ahri.png')).headers.get('content-type'),
    'image/png',
  );
  assert.ok(isAppUrl(backend.origin + '/#workspace', backend.origin));
  for (const url of [
    'file:///C:/private',
    'https://untrusted.test',
    backend.origin.replace('127.0.0.1', '127.0.0.1.evil.test'),
    backend.origin.replace('127.0.0.1', 'name@127.0.0.1'),
  ])
    assert.equal(isAppUrl(url, backend.origin), false);
  const port = Number(new URL(backend.origin).port);
  await assert.rejects(startDesktopServer({port, env: {}, labDirectory: root}), {code: 'EADDRINUSE'});
  await backend.close();
  const reopened = await startDesktopServer({port, env: {}, labDirectory: root});
  await reopened.close();
});

test('desktop packaging uses an explicit file allowlist with no private config or snapshots', async () => {
  const build = JSON.parse(await readFile(new URL('../electron-builder.json', import.meta.url), 'utf8'));
  assert.ok(build.files.includes('server/riotgames.pem'));
  assert.ok(build.files.includes('public/**/*'), 'Data Lab frontend must be packaged');
  assert.ok(build.files.includes('server/**/*.js'), 'LCU, AI and Data Lab backend must be packaged');
  assert.equal(
    build.files.some(
      pattern => pattern === '**/*' || pattern.startsWith('.local') || pattern.startsWith('.env'),
    ),
    false,
  );
  assert.equal(build.electronFuses.runAsNode, false);
  assert.equal(build.portable.requestExecutionLevel, 'user');
  const template = await readFile(new URL('../desktop/default.env', import.meta.url), 'utf8');
  const config = desktopConfig(template, tmpdir());
  assert.equal(config.env.RIOT_API_KEY, '');
  assert.equal(config.env.AI_API_KEY, '');
});
