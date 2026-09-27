// Local-only module. Never import this from the hosted Worker or browser bundles.
import {randomUUID} from 'node:crypto';
import {constants} from 'node:fs';
import {lstat, mkdir, open, readdir, realpath, unlink} from 'node:fs/promises';
import {join, parse, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {RiotError, RIOT_REGIONS, parseLookup, createRiotClient, createMemoryRiotCache} from './riot.js';
import {jsonResponse} from './worker.js';
import {createLabSnapshot, createDemoLabSnapshot, exportLabSnapshot, replaceLabRecordRaw, getLabRecordPlayerPuuid, LAB_MAX_BYTES} from '../public/data-lab-model.js';

export const LAB_BODY_LIMIT = LAB_MAX_BYTES;
export const defaultLabDirectory = fileURLToPath(new URL('../.local/data-lab/', import.meta.url));
const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const maxSnapshots = 100;
const missing = () => new RiotError('NOT_FOUND', 'Không tìm thấy dữ liệu Data Lab.', 404);
const storageError = () => new RiotError('LAB_STORAGE_ERROR', 'Không thể truy cập bộ nhớ Data Lab local.', 500);

// Check every existing ancestor before creating directories: a .local symlink must
// never redirect stored snapshots into another directory. File descriptors use
// O_NOFOLLOW and exclusive creation as a second boundary.
async function safeDirectory(directory, create = false) {
  const absolute = resolve(directory);
  let current = parse(absolute).root;
  for (const part of absolute.slice(current.length).split(sep).filter(Boolean)) {
    current = join(current, part);
    try {
      const entry = await lstat(current);
      if (entry.isSymbolicLink() || !entry.isDirectory()) throw storageError();
    } catch (error) {
      if (error.code !== 'ENOENT') throw storageError();
      if (!create) return null;
      try { await mkdir(current, {mode: 0o700}); }
      catch (error) { if (error.code !== 'EEXIST') throw storageError(); }
      const entry = await lstat(current);
      if (entry.isSymbolicLink() || !entry.isDirectory()) throw storageError();
    }
  }
  if (await realpath(absolute) !== absolute) throw storageError();
  return absolute;
}

async function readSaved(directory, id) {
  if (!idPattern.test(id)) throw missing();
  const root = await safeDirectory(directory);
  if (!root) throw missing();
  let file;
  try {
    file = await open(join(root, id + '.json'), constants.O_RDONLY | constants.O_NOFOLLOW);
    const info = await file.stat();
    if (!info.isFile() || info.nlink !== 1 || info.size > LAB_BODY_LIMIT) throw missing();
    const payload = JSON.parse(await file.readFile('utf8'));
    return {id, snapshot: exportLabSnapshot(payload)};
  } catch (error) {
    if (error instanceof RiotError) throw error;
    if (['ENOENT', 'ELOOP', 'EISDIR'].includes(error.code)) throw missing();
    throw storageError();
  } finally { await file?.close(); }
}

async function listSaved(directory) {
  const root = await safeDirectory(directory);
  if (!root) return [];
  const ids = (await readdir(root, {withFileTypes: true}))
    .filter(entry => entry.isFile() && entry.name.endsWith('.json') && idPattern.test(entry.name.slice(0, -5)))
    .map(entry => entry.name.slice(0, -5));
  if (ids.length > maxSnapshots) throw storageError();
  const snapshots = [];
  for (const id of ids) {
    const {snapshot} = await readSaved(root, id);
    snapshots.push({id, source: snapshot.source, collectedAt: snapshot.collectedAt, count: snapshot.records.length});
  }
  return snapshots.sort((a, b) => b.collectedAt.localeCompare(a.collectedAt));
}

// Serialize saves per server instance so simultaneous imports cannot exceed the cap.
export function createDataLab({directory = defaultLabDirectory, env = {}, fetchImpl = fetch} = {}) {
  const cache = createMemoryRiotCache();
  let pendingSave = Promise.resolve();
  function save(snapshot) {
    const operation = pendingSave.then(async () => {
      const root = await safeDirectory(directory, true);
      const entries = await readdir(root, {withFileTypes: true});
      if (entries.filter(entry => entry.name.endsWith('.json')).length >= maxSnapshots) {
        throw new RiotError('LAB_STORAGE_FULL', 'Data Lab đã đạt giới hạn 100 snapshot. Sao lưu và dọn thư mục local trước khi lưu thêm.', 409);
      }
      const serialized = JSON.stringify(exportLabSnapshot(snapshot));
      if (Buffer.byteLength(serialized) > LAB_BODY_LIMIT) throw new RiotError('INPUT_TOO_LARGE', 'Snapshot Data Lab quá lớn.', 413);
      const id = randomUUID();
      const file = await open(join(root, id + '.json'), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      try { await file.writeFile(serialized); }
      catch (error) { await unlink(join(root, id + '.json')); throw error; }
      finally { await file.close(); }
      return {id, snapshot: JSON.parse(serialized)};
    });
    pendingSave = operation.catch(() => {});
    return operation;
  }
  return async function handleDataLab(request) {
    const path = new URL(request.url).pathname;
    const id = path.startsWith('/api/lab/snapshots/') ? path.slice('/api/lab/snapshots/'.length) : null;
    const methods = path === '/api/lab/status' || id !== null ? ['GET']
      : path === '/api/lab/snapshots' ? ['GET', 'POST']
      : ['/api/lab/demo', '/api/lab/collect', '/api/lab/enrich'].includes(path) ? ['POST'] : null;
    if (!methods || id !== null && !idPattern.test(id)) return jsonResponse({error: {code: 'NOT_FOUND', message: 'Không tìm thấy chức năng Data Lab.'}}, 404);
    if (!methods.includes(request.method)) return jsonResponse({error: {code: 'METHOD_NOT_ALLOWED', message: 'Phương thức Data Lab không hợp lệ.'}}, 405, {Allow: methods.join(', ')});
    try {
      if (path === '/api/lab/status') return jsonResponse({enabled: true});
      if (request.method === 'GET') return jsonResponse(id ? await readSaved(directory, id) : {snapshots: await listSaved(directory)});
      const input = await parseBody(request);
      if (path === '/api/lab/demo') {
        if (![10, 20].includes(input?.count)) throw new RiotError('INVALID_COUNT', 'Chọn 10 hoặc 20 trận mẫu.', 400);
        return jsonResponse({snapshot: createDemoLabSnapshot(input.count)});
      }
      if (path === '/api/lab/collect') return jsonResponse(await save(await collect(input, request.url, env, cache, fetchImpl)), 201);
      if (path === '/api/lab/enrich') return jsonResponse(await save(await enrich(input, request.url, env, cache, fetchImpl)), 201);
      const payload = input?.snapshot ?? input?.history ?? input;
      return jsonResponse(await save(createLabSnapshot(payload, {source: payload?.source === 'demo' ? 'demo' : 'imported'})), 201);
    } catch (error) {
      const known = error instanceof RiotError;
      const invalid = error?.code === 'INVALID_LAB_DATA';
      return jsonResponse({error: {code: known ? error.code : invalid ? 'INVALID_LAB_DATA' : 'LAB_STORAGE_ERROR',
        message: known ? error.message : invalid ? 'Dữ liệu Data Lab không hợp lệ hoặc vượt giới hạn 20 trận.' : 'Không thể xử lý dữ liệu Data Lab local.',
        ...(known && error.retryAfter ? {retryAfter: error.retryAfter} : {})}}, known ? error.status : invalid ? 400 : 500,
      known && error.retryAfter ? {'Retry-After': String(error.retryAfter)} : {});
    }
  };
}

async function parseBody(request) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type') || '')) {
    throw new RiotError('INVALID_CONTENT', 'Dữ liệu Data Lab cần là JSON.', 415);
  }
  const text = await request.text();
  if (Buffer.byteLength(text) > LAB_BODY_LIMIT) throw new RiotError('INPUT_TOO_LARGE', 'Snapshot Data Lab quá lớn.', 413);
  try { return JSON.parse(text); }
  catch { throw new RiotError('INVALID_JSON', 'JSON Data Lab không hợp lệ.', 400); }
}

async function collect(input, url, env, cache, fetchImpl) {
  const query = parseLookup(input);
  if (query.mode !== 'sr' || query.start !== 0) throw new RiotError('INVALID_INPUT', 'Data Lab thu thập 10 hoặc 20 trận gần nhất, không lọc Mayhem.', 400);
  const client = createRiotClient({key: env.RIOT_API_KEY, origin: new URL(url).origin, cache, fetchImpl});
  const region = RIOT_REGIONS[query.region];
  const account = await client.get('asia', `/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(query.gameName)}/${encodeURIComponent(query.tagLine)}`, 600);
  if (typeof account?.puuid !== 'string' || !account.puuid || account.puuid.length > 128) throw new RiotError('RIOT_BAD_ACCOUNT', 'Riot chưa trả định danh tài khoản hợp lệ.', 502);
  try { await client.get(region.platform, `/lol/summoner/v4/summoners/by-puuid/${encodeURIComponent(account.puuid)}`, 600); }
  catch (error) { if (error.code === 'RIOT_NOT_FOUND') throw new RiotError('WRONG_SERVER', 'Riot ID chưa có hồ sơ LoL trên server đã chọn.', 404); throw error; }
  const ids = await client.get(region.routing, `/lol/match/v5/matches/by-puuid/${encodeURIComponent(account.puuid)}/ids?start=0&count=${query.count}`, 120);
  if (!Array.isArray(ids) || ids.length > query.count || ids.some(id => typeof id !== 'string' || !/^[A-Z0-9]+_\d{1,20}$/.test(id))) throw new RiotError('RIOT_BAD_LIST', 'Danh sách trận từ Riot không hợp lệ.', 502);
  if (!ids.length) throw new RiotError('NO_MATCHES', 'Riot chưa trả lịch sử trận cho truy vấn này. Data Lab không tạo dữ liệu thay thế.', 404);
  const rawMatches = [];
  for (const id of [...new Set(ids)]) {
    const raw = await client.get(region.routing, `/lol/match/v5/matches/${encodeURIComponent(id)}`, 86400);
    if (raw?.metadata?.matchId !== id) throw new RiotError('RIOT_BAD_DATA', 'Riot trả định danh trận không khớp.', 502);
    rawMatches.push(raw);
  }
  return createLabSnapshot({rawMatches, playerPuuid: account.puuid, profile: {
    riotId: `${account.gameName || query.gameName}#${account.tagLine || query.tagLine}`, region: region.label,
  }}, {source: 'riot'});
}


async function enrich(input, url, env, cache, fetchImpl) {
  const matchId = input?.matchId;
  const platform = typeof matchId === 'string' ? matchId.match(/^([A-Z0-9]+)_\d{1,20}$/)?.[1].toLowerCase() : null;
  const region = Object.values(RIOT_REGIONS).find(candidate => candidate.platform === platform);
  if (!region) throw new RiotError('INVALID_MATCH', 'Mã trận không hợp lệ hoặc server chưa được hỗ trợ.', 400);
  if (input.region !== undefined) {
    const selected = typeof input.region === 'string' && Object.hasOwn(RIOT_REGIONS, input.region.toLowerCase()) ? RIOT_REGIONS[input.region.toLowerCase()] : null;
    if (!selected || selected.platform !== platform) throw new RiotError('INVALID_REGION', 'Server không khớp với mã trận cần bổ sung.', 400);
  }
  const snapshot = createLabSnapshot(input.snapshot, {source: 'imported'});
  const record = snapshot.records.find(entry => entry.matchId === matchId);
  if (record?.raw?.kind !== 'riot' || record.raw.projection !== true) {
    throw new RiotError('LAB_NOT_PROJECTED', 'Chỉ bổ sung từng trận có dữ liệu Riot đã rút gọn.', 400);
  }
  let puuid;
  try { puuid = getLabRecordPlayerPuuid(record); }
  catch (error) {
    if (error?.code !== 'INVALID_LAB_DATA') throw error;
    throw new RiotError('LAB_PLAYER_UNKNOWN', 'Snapshot chưa đủ định danh người chơi để bổ sung an toàn. Tra cứu lại Riot ID trong Data Lab.', 400);
  }
  const client = createRiotClient({key: env.RIOT_API_KEY, origin: new URL(url).origin, cache, fetchImpl});
  const raw = await client.get(region.routing, `/lol/match/v5/matches/${encodeURIComponent(matchId)}`, 86400);
  if (raw?.metadata?.matchId !== matchId) throw new RiotError('RIOT_BAD_DATA', 'Riot trả định danh trận không khớp.', 502);
  if (!Array.isArray(raw.info?.participants) || raw.info.participants.some(player => !player || typeof player !== 'object')
      || raw.info.participants.filter(player => player.puuid === puuid).length !== 1) {
    throw new RiotError('PLAYER_MISMATCH', 'Chi tiết Riot chưa chứa đúng một người chơi của snapshot.', 502);
  }
  return replaceLabRecordRaw(snapshot, matchId, raw);
}
