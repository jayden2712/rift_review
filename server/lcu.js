// Local-only reader for the League client's own API (LCU). Riot's public MATCH-V5 API does
// not serve ARAM Mayhem, but the signed-in client exposes the player's history locally.
// Read-only: GET requests to an allowlist of paths, never forwarded to the browser as-is.
import {readFileSync} from 'node:fs';
import {request} from 'node:https';
import {join} from 'node:path';
import {RiotError, RIOT_REGIONS} from './riot.js';
import {championNames, mapLcuGame} from './lcu-map.js';

const DEFAULT_INSTALL_DIR = 'C:/Riot Games/League of Legends';
const PRODUCT = 'league_of_legends.live';
const REQUEST_TIMEOUT_MS = 15000;
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
// The client only returns its latest 20 games; paging parameters are ignored.
const MATCH_LIST_PATH = '/lol-match-history/v1/products/lol/current-summoner/matches?begIndex=0&endIndex=19';
const ALLOWED_PATHS = [
  /^\/lol-summoner\/v1\/current-summoner$/,
  /^\/riotclient\/region-locale$/,
  /^\/lol-match-history\/v1\/products\/lol\/current-summoner\/matches\?begIndex=0&endIndex=19$/,
  /^\/lol-match-history\/v1\/games\/\d{1,20}$/,
  /^\/lol-game-data\/assets\/v1\/champion-summary\.json$/,
];
// Riot's published LCU root certificate (static.developer.riotgames.com/docs/lol/riotgames.pem).
// The client certificate names 127.0.0.1, so normal hostname verification also applies.
const riotRootCertificate = readFileSync(new URL('./riotgames.pem', import.meta.url), 'utf8');

const lcuError = (code, message, status = 503) => new RiotError(code, message, status);

export function parseLockfile(text) {
  const parts = String(text).trim().split(':');
  if (parts.length !== 5) return null;
  const [name, pid, rawPort, password, protocol] = parts;
  const port = Number(rawPort);
  if (name !== 'LeagueClient' || !/^\d+$/.test(pid) || protocol !== 'https') return null;
  if (!/^\d+$/.test(rawPort) || port < 1 || port > 65535 || !/^[\w-]{1,128}$/.test(password)) return null;
  return {port, password};
}

function readOptional(readFile, path) {
  try {
    return readFile(path, 'utf8');
  } catch {
    return null;
  }
}

export function installDirCandidates({
  env = {},
  programData = process.env.ProgramData,
  readFile = readFileSync,
} = {}) {
  const dirs = [];
  if (typeof env.LCU_INSTALL_DIR === 'string' && env.LCU_INSTALL_DIR.trim())
    dirs.push(env.LCU_INSTALL_DIR.trim());
  if (programData) {
    const settings = readOptional(
      readFile,
      join(programData, 'Riot Games', 'Metadata', PRODUCT, `${PRODUCT}.product_settings.yaml`),
    );
    const recorded = settings?.match(/^product_install_full_path:\s*"?([^"\r\n]+?)"?\s*$/m)?.[1];
    if (recorded) dirs.push(recorded);
  }
  dirs.push(DEFAULT_INSTALL_DIR);
  return [...new Set(dirs)];
}

export function findLcuCredentials(dirs, readFile = readFileSync) {
  for (const dir of dirs) {
    const text = readOptional(readFile, join(dir, 'lockfile'));
    const credentials = text === null ? null : parseLockfile(text);
    if (credentials) return credentials;
  }
  return null;
}

function httpsGet({port, path, authorization}) {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: '127.0.0.1',
        port,
        path,
        method: 'GET',
        ca: riotRootCertificate,
        headers: {Authorization: authorization, Accept: 'application/json'},
        timeout: REQUEST_TIMEOUT_MS,
      },
      res => {
        const chunks = [];
        let size = 0;
        res.on('data', chunk => {
          size += chunk.length;
          if (size > MAX_RESPONSE_BYTES)
            req.destroy(Object.assign(new Error('too large'), {code: 'LCU_TOO_LARGE'}));
          else chunks.push(chunk);
        });
        res.on('end', () => resolve({status: res.statusCode, body: Buffer.concat(chunks).toString('utf8')}));
        res.on('error', reject);
      },
    );
    req.on('timeout', () => req.destroy(Object.assign(new Error('timeout'), {code: 'ETIMEDOUT'})));
    req.on('error', reject);
    req.end();
  });
}

export function createLcuClient({credentials, requestImpl = httpsGet}) {
  // Built once; the password itself never appears in errors or responses.
  const authorization = 'Basic ' + Buffer.from('riot:' + credentials.password).toString('base64');
  async function get(path) {
    if (typeof path !== 'string' || !ALLOWED_PATHS.some(pattern => pattern.test(path)))
      throw lcuError('LCU_PATH_REJECTED', 'Đường dẫn client LoL không được phép.', 500);
    let response;
    try {
      response = await requestImpl({port: credentials.port, path, authorization});
    } catch (error) {
      if (['ECONNREFUSED', 'ECONNRESET'].includes(error?.code))
        throw lcuError(
          'LCU_CLIENT_CLOSED',
          'Client LoL chưa mở hoặc vừa tắt. Mở League of Legends rồi thử lại.',
        );
      if (error?.code === 'ETIMEDOUT')
        throw lcuError('LCU_TIMEOUT', 'Client LoL phản hồi quá lâu. Thử lại sau.', 504);
      throw lcuError('LCU_UNAVAILABLE', 'Không kết nối được client LoL.', 502);
    }
    if (response.status === 404) throw lcuError('LCU_NOT_FOUND', 'Client LoL không có dữ liệu này.', 404);
    if (response.status < 200 || response.status >= 300)
      throw lcuError('LCU_UNAVAILABLE', `Client LoL chưa trả được dữ liệu (HTTP ${response.status}).`, 502);
    try {
      return JSON.parse(response.body);
    } catch {
      throw lcuError('LCU_BAD_DATA', 'Client LoL trả dữ liệu không đọc được.', 502);
    }
  }
  return {get};
}

export function connectLcu({env = {}, readFile = readFileSync, programData, requestImpl} = {}) {
  const credentials = findLcuCredentials(installDirCandidates({env, programData, readFile}), readFile);
  if (!credentials)
    throw lcuError('LCU_CLIENT_CLOSED', 'Không thấy client LoL đang chạy. Mở League of Legends rồi thử lại.');
  return createLcuClient({credentials, requestImpl});
}

async function signedInAccount(client) {
  const summoner = await client.get('/lol-summoner/v1/current-summoner');
  if (typeof summoner?.puuid !== 'string' || !summoner.puuid || !summoner.gameName || !summoner.tagLine)
    throw lcuError(
      'LCU_NOT_SIGNED_IN',
      'Client LoL chưa đăng nhập xong. Đợi vào màn hình chính rồi thử lại.',
    );
  return summoner;
}

function regionFor(locale) {
  const platform = String(locale?.region ?? '').toLowerCase();
  return Object.values(RIOT_REGIONS).find(region => region.platform === platform) ?? null;
}

export async function lcuStatus(client) {
  const summoner = await signedInAccount(client);
  return {status: 'connected', riotId: `${summoner.gameName}#${summoner.tagLine}`};
}

export async function loadLcuMayhem(client) {
  const summoner = await signedInAccount(client);
  const region = regionFor(await client.get('/riotclient/region-locale'));
  if (!region) throw lcuError('LCU_BAD_DATA', 'Không xác định được server của client LoL.', 502);
  const list = (await client.get(MATCH_LIST_PATH))?.games?.games;
  if (!Array.isArray(list)) throw lcuError('LCU_BAD_DATA', 'Danh sách trận từ client LoL không hợp lệ.', 502);
  const ids = [...new Set(list.filter(g => g?.queueId === 2400).map(g => g.gameId))].filter(
    Number.isSafeInteger,
  );
  if (!ids.length)
    throw lcuError('NO_MATCHES', 'Không có trận ARAM Mayhem trong 20 trận gần nhất của client LoL.', 404);
  const champions = championNames(await client.get('/lol-game-data/assets/v1/champion-summary.json'));
  const matches = [],
    details = {},
    warnings = [];
  for (const gameId of ids) {
    let game;
    try {
      game = await client.get(`/lol-match-history/v1/games/${gameId}`);
    } catch (error) {
      if (error.code !== 'LCU_NOT_FOUND') throw error;
      warnings.push({id: String(gameId), reason: 'Client LoL chưa cung cấp chi tiết trận'});
      continue;
    }
    const mapped = mapLcuGame(game, summoner.puuid, champions);
    if (mapped.skipped) warnings.push({id: String(gameId), reason: mapped.skipped});
    else {
      matches.push(mapped.match);
      details[mapped.match.id] = mapped.detail;
    }
  }
  if (!matches.length)
    throw lcuError('NO_SUPPORTED_MATCHES', 'Không có trận ARAM Mayhem hợp lệ từ client LoL.', 422);
  const source = {
    provider: 'lcu',
    mode: 'mayhem',
    start: 0,
    count: ids.length,
    nextStart: ids.length,
    hasMore: false,
    accountKey: `${region.platform}:${summoner.puuid}`,
    requested: ids.length,
    returned: ids.length,
    included: matches.length,
    loadedAt: new Date().toISOString(),
  };
  const history = {
    schemaVersion: 3,
    profile: {
      riotId: `${summoner.gameName}#${summoner.tagLine}`,
      region: region.label,
      rank: '',
      ...(Number.isInteger(summoner.profileIconId) &&
      summoner.profileIconId >= 0 &&
      summoner.profileIconId <= 999999
        ? {profileIconId: summoner.profileIconId}
        : {}),
    },
    matches,
    details,
  };
  return {history, details, warnings, source};
}
