import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';

const configModule = new URL('../server/local-config.js', import.meta.url).href;
function readConfig(path, extraEnv = {}) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !['RIOT_API_KEY', 'PORT', 'NODE_OPTIONS'].includes(key)));
  return spawnSync(process.execPath, ['--input-type=module', '-e', `
    import {loadLocalConfig} from ${JSON.stringify(configModule)};
    try { console.log(JSON.stringify(loadLocalConfig(process.argv[1]))); }
    catch (error) { console.error(error.message); process.exitCode = 1; }
  `, path], {env: {...env, ...extraEnv}, encoding: 'utf8'});
}

test('local config loads .env, handles missing file and honors shell overrides', async t => {
  const root = await mkdtemp(join(tmpdir(), 'rift-env-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const file = join(root, '.env');
  const missing = readConfig(file);
  assert.equal(missing.status, 0);
  assert.deepEqual(JSON.parse(missing.stdout), {port: 4173, env: {RIOT_API_KEY: ''}});
  await writeFile(file, '# comment\nRIOT_API_KEY="fixture-file-secret"\nPORT=4180\n');
  assert.deepEqual(JSON.parse(readConfig(file).stdout), {port: 4180, env: {RIOT_API_KEY: 'fixture-file-secret'}});
  const overridden = readConfig(file, {RIOT_API_KEY: 'fixture-shell-secret', PORT: '4190'});
  assert.deepEqual(JSON.parse(overridden.stdout), {port: 4190, env: {RIOT_API_KEY: 'fixture-shell-secret'}});
  await writeFile(file, 'RIOT_API_KEY="  "\n');
  assert.equal(JSON.parse(readConfig(file).stdout).env.RIOT_API_KEY, '');
});

test('local config rejects invalid ports without echoing environment values', async t => {
  const root = await mkdtemp(join(tmpdir(), 'rift-env-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  for (const port of ['0', '-1', '65536', '1.5', 'fixture-secret', '']) {
    const result = readConfig(join(root, '.env'), {PORT: port});
    assert.equal(result.status, 1);
    assert.match(result.stderr, /PORT/);
    assert.ok(!result.stderr.includes('fixture-secret'));
  }
  const unreadable = readConfig(root);
  assert.equal(unreadable.status, 1);
  assert.match(unreadable.stderr, /\.env/);
});
