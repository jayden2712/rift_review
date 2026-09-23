import {fileURLToPath} from 'node:url';

const defaultEnvFile = fileURLToPath(new URL('../.env', import.meta.url));

export function loadLocalConfig(envFile = defaultEnvFile) {
  if (typeof process.loadEnvFile !== 'function') {
    throw new Error('Backend local cần Node.js 20.12 trở lên.');
  }
  try {
    // Node preserves environment variables already supplied by the shell.
    process.loadEnvFile(envFile);
  } catch (error) {
    if (error.code !== 'ENOENT') throw new Error('Không đọc được file .env. Kiểm tra quyền truy cập.');
  }
  const rawPort = process.env.PORT ?? '4173';
  const port = Number(rawPort);
  if (!/^\d+$/.test(rawPort) || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT cần là số nguyên từ 1 đến 65535.');
  }
  return {port, env: {RIOT_API_KEY: (process.env.RIOT_API_KEY ?? '').trim()}};
}
