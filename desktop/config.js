import {constants} from 'node:fs';
import {copyFile, lstat, mkdir, readFile, readdir, rename, writeFile} from 'node:fs/promises';
import {dirname, isAbsolute, join, resolve} from 'node:path';
import {parseEnv} from 'node:util';

const fields = [
  'RIOT_API_KEY',
  'LCU_ENABLED',
  'LCU_INSTALL_DIR',
  'DATA_LAB_ENABLED',
  'AI_ENABLED',
  'AI_BASE_URL',
  'AI_MODEL',
  'AI_API_KEY',
  'AI_REASONING_EFFORT',
  'AI_STYLE_FILE',
];
async function optionalFile(path, maximum) {
  let info;
  try {
    info = await lstat(path);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  if (!info.isFile() || info.isSymbolicLink() || info.size > maximum)
    throw new Error('File cấu hình hoặc dữ liệu không hợp lệ.');
  return readFile(path);
}

export function desktopConfig(text, userData) {
  // Parse only; never load arbitrary .env variables into the Electron process.
  const parsed = parseEnv(text);
  const rawPort = parsed.DESKTOP_PORT ?? '4179';
  const port = Number(rawPort);
  if (!/^\d+$/.test(rawPort) || !Number.isInteger(port) || port < 1024 || port > 65535)
    throw new Error('DESKTOP_PORT cần là số nguyên từ 1024 đến 65535.');
  const env = Object.fromEntries(fields.map(key => [key, (parsed[key] ?? '').trim()]));
  for (const key of ['LCU_ENABLED', 'DATA_LAB_ENABLED', 'AI_ENABLED'])
    env[key] = env[key] === '1' ? '1' : '0';
  const style = env.AI_STYLE_FILE || '.local/ai-style.md';
  env.AI_STYLE_FILE = isAbsolute(style) ? style : resolve(userData, style);
  return {port, env, labDirectory: join(userData, '.local', 'data-lab')};
}

export async function importDesktopConfig(sourceFile, userData, {overwrite = false} = {}) {
  const source = await optionalFile(sourceFile, 65536);
  if (!source) throw new Error('Không tìm thấy file cấu hình đã chọn.');
  const destination = join(userData, '.env');
  const previous = await optionalFile(destination, 65536);
  if (previous && !overwrite) return {imported: false, snapshots: 0};
  const text = source.toString('utf8');
  desktopConfig(text, userData);
  const sourceRoot = dirname(resolve(sourceFile));
  const styleSetting = parseEnv(text).AI_STYLE_FILE || '.local/ai-style.md';
  const stylePath = isAbsolute(styleSetting) ? styleSetting : resolve(sourceRoot, styleSetting);
  const style = await optionalFile(stylePath, 65536);
  await mkdir(join(userData, '.local'), {recursive: true});
  if (style) {
    // Preserve a previous personal style when importing another config.
    try {
      await writeFile(join(userData, '.local', 'ai-style.md'), style, {flag: 'wx', mode: 0o600});
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
  }
  let snapshots = 0;
  const sourceLab = join(sourceRoot, '.local', 'data-lab');
  let entries = [];
  try {
    const info = await lstat(sourceLab);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Thư mục Data Lab không hợp lệ.');
    entries = await readdir(sourceLab, {withFileTypes: true});
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const targetLab = join(userData, '.local', 'data-lab');
  await mkdir(targetLab, {recursive: true});
  for (const entry of entries.filter(e => /^[0-9a-f-]{36}\.json$/.test(e.name)).slice(0, 100)) {
    if (!entry.isFile() || entry.isSymbolicLink()) continue;
    const path = join(sourceLab, entry.name);
    if ((await lstat(path)).size > 8 * 1024 * 1024) continue;
    try {
      await copyFile(path, join(targetLab, entry.name), constants.COPYFILE_EXCL);
      snapshots++;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
  }
  if (previous)
    await copyFile(destination, join(userData, `.env.backup-${Date.now()}`), constants.COPYFILE_EXCL);
  // Copied styles live with the app's data, independent of the source checkout.
  const importedText = style ? text + '\n# Personal style copied into desktop data.\nAI_STYLE_FILE=\n' : text;
  await writeFile(join(userData, '.env.pending'), importedText, {mode: 0o600});
  await rename(join(userData, '.env.pending'), destination);
  return {imported: true, snapshots};
}

export async function initializeDesktopData({userData, templateFile, importFile}) {
  await mkdir(userData, {recursive: true});
  const path = join(userData, '.env');
  if (!(await optionalFile(path, 65536))) {
    if (importFile) await importDesktopConfig(importFile, userData);
    else await copyFile(templateFile, path, constants.COPYFILE_EXCL);
  }
  return desktopConfig((await optionalFile(path, 65536)).toString('utf8'), userData);
}
