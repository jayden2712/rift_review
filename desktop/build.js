import {build, Platform} from 'electron-builder';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {readFile} from 'node:fs/promises';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// Builder only replaces its dedicated output folder, never the web Worker dist/.
const output = resolve(root, 'release');
const config = JSON.parse(await readFile(resolve(root, 'electron-builder.json'), 'utf8'));
if (resolve(root, config.directories.output) !== output)
  throw new Error('Unexpected desktop output directory');
process.env.CSC_IDENTITY_AUTO_DISCOVERY = 'false';
await build({
  projectDir: root,
  config,
  targets: Platform.WINDOWS.createTarget('portable'),
  publish: 'never',
});
