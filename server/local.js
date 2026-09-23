import {createServer} from 'node:http';
import {readFile, realpath} from 'node:fs/promises';
import {extname, resolve, sep} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {handleApi, jsonResponse} from './worker.js';
import {RiotError} from './riot.js';
import {loadLocalConfig} from './local-config.js';

const publicRoot = fileURLToPath(new URL('../public/', import.meta.url));
const bodyLimit = 2048;
const mimeTypes = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
});

function validateLocalRequest(incoming) {
  const port = incoming.socket.localPort;
  const host = incoming.headers.host;
  const hosts = port === 80 ? ['localhost:80', '127.0.0.1:80', 'localhost', '127.0.0.1']
    : ['localhost:' + port, '127.0.0.1:' + port];
  const peer = incoming.socket.remoteAddress;
  if (!['127.0.0.1', '::ffff:127.0.0.1', '::1'].includes(peer) || !hosts.includes(host)) {
    throw new RiotError('LOCAL_ONLY', 'Backend này chỉ nhận yêu cầu trên máy local.', 403);
  }
  const origin = new URL('http://' + host).origin;
  if ((incoming.headers.origin && incoming.headers.origin !== origin) || incoming.headers['sec-fetch-site'] === 'cross-site') {
    throw new RiotError('ORIGIN_REJECTED', 'Yêu cầu không đến từ web local này.', 403);
  }
  if (!incoming.url.startsWith('/') || incoming.url.startsWith('//') || incoming.url.includes('\\')) {
    throw new RiotError('INVALID_URL', 'Đường dẫn không hợp lệ.', 400);
  }
  return new URL(incoming.url, origin);
}

async function readBody(incoming) {
  if (Number(incoming.headers['content-length']) > bodyLimit) {
    throw new RiotError('INPUT_TOO_LARGE', 'Riot ID quá dài.', 413);
  }
  let body = Buffer.alloc(0);
  // Preserve the socket on early exit so oversized requests receive a JSON error.
  for await (const chunk of incoming.iterator({destroyOnReturn: false})) {
    if (body.length + chunk.length > bodyLimit) {
      throw new RiotError('INPUT_TOO_LARGE', 'Riot ID quá dài.', 413);
    }
    body = Buffer.concat([body, chunk]);
  }
  return body;
}

async function serveApi(incoming, url, env, fetchImpl) {
  const headers = new Headers(Object.entries(incoming.headers)
    .filter(([name]) => ['content-type', 'origin', 'sec-fetch-site'].includes(name)));
  // The local boundary has already been checked; never trust a supplied identity.
  headers.set('oai-authenticated-user-id', 'local-developer');
  const body = ['GET', 'HEAD'].includes(incoming.method) ? undefined : await readBody(incoming);
  const request = new Request(url, {method: incoming.method, headers, body});
  return handleApi(request, env, {fetchImpl});
}

async function serveStatic(incoming, url, directory) {
  if (!['GET', 'HEAD'].includes(incoming.method)) {
    return new Response('Method not allowed', {status: 405, headers: {Allow: 'GET, HEAD'}});
  }
  let path;
  try { path = decodeURIComponent(url.pathname); }
  catch { return new Response('Invalid path', {status: 400}); }
  const file = path === '/' ? 'index.html' : path.slice(1);
  // Permit only known frontend files and game icons, never arbitrary nested paths.
  const allowed = /^[a-zA-Z0-9_-]+\.(html|js|css|svg)$/.test(file)
    || /^(champions|items|spells|runes|ranks)\/[a-zA-Z0-9]+\.png$/.test(file);
  if (!allowed) return new Response('Not found', {status: 404});
  try {
    const root = await realpath(directory);
    const target = await realpath(resolve(root, file));
    if (!target.startsWith(root + sep) || target !== resolve(root, file)) return new Response('Not found', {status: 404});
    const body = await readFile(target);
    return new Response(incoming.method === 'HEAD' ? null : body, {headers: {
      'Content-Type': mimeTypes[extname(file)], 'Content-Length': String(body.length),
      'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin',
    }});
  } catch (error) {
    if (['ENOENT', 'ENOTDIR', 'EISDIR'].includes(error.code)) return new Response('Not found', {status: 404});
    throw error;
  }
}

export function createLocalServer({env = {}, publicDirectory = publicRoot, fetchImpl = fetch} = {}) {
  const localEnv = {RIOT_API_KEY: typeof env.RIOT_API_KEY === 'string' ? env.RIOT_API_KEY.trim() : ''};
  return createServer({requestTimeout: 15000, headersTimeout: 10000}, async (incoming, outgoing) => {
    try {
      const url = validateLocalRequest(incoming);
      const response = url.pathname.startsWith('/api/')
        ? await serveApi(incoming, url, localEnv, fetchImpl)
        : await serveStatic(incoming, url, publicDirectory);
      const body = Buffer.from(await response.arrayBuffer());
      outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      outgoing.end(incoming.method === 'HEAD' ? undefined : body);
    } catch (error) {
      if (outgoing.destroyed) return;
      const known = error instanceof RiotError;
      // Do not log raw exceptions, request headers or environment values.
      if (!known) console.error('Backend local: không thể xử lý yêu cầu.');
      const response = jsonResponse({error: {
        code: known ? error.code : 'SERVER_ERROR',
        message: known ? error.message : 'Máy chủ local gặp lỗi. Hãy thử lại.',
      }}, known ? error.status : 500, {Connection: 'close'});
      outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      outgoing.end(await response.text());
    }
  });
}

function main() {
  let config;
  try { config = loadLocalConfig(); }
  catch (error) { console.error(error.message); process.exitCode = 1; return; }
  const server = createLocalServer({env: config.env});
  server.on('error', error => {
    console.error(error.code === 'EADDRINUSE'
      ? 'Cổng local đang được sử dụng. Dừng server cũ hoặc đổi PORT trong .env.'
      : 'Không khởi động được backend local. Kiểm tra cổng và quyền truy cập.');
    process.exitCode = 1;
  });
  server.listen(config.port, '127.0.0.1', () => {
    console.log('Rift Review: http://localhost:' + config.port);
    console.log(config.env.RIOT_API_KEY
      ? 'Đã cấu hình Riot API key (chưa xác minh với Riot).'
      : 'Chưa có Riot API key. Điền RIOT_API_KEY trong .env rồi khởi động lại server.');
  });
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) main();
