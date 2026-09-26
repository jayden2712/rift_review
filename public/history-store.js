import {normalizeHistory, exportHistory, MAX_MATCHES, MAX_JSON_LENGTH} from './history-data.js';

export const HISTORY_STORAGE_KEY = 'rift-review-history-v1';
const SNAPSHOT_VERSION = 1;
const REGIONS = new Set(['oce', 'vn', 'kr', 'jp', 'na', 'br', 'lan', 'las', 'euw', 'eune', 'tr', 'ru', 'sg', 'tw']);

export class HistoryStoreError extends Error {
  constructor(code) {
    super(code);
    this.name = 'HistoryStoreError';
    this.code = code;
  }
}

const fail = code => {throw new HistoryStoreError(code);};
const identity = value => String(value ?? '').trim().toLowerCase();
const storageFor = storage => storage === undefined ? globalThis.localStorage : storage;
const modeOf = history => {
  const modes = new Set(history.matches.map(match => match.queue === 'ARAM Mayhem' ? 'mayhem' : 'sr'));
  return modes.size === 1 ? [...modes][0] : 'mixed';
};

function cleanQuery(input, history) {
  if (input === undefined || input === null) return null;
  if (typeof input !== 'object' || Array.isArray(input)) fail('invalid_query');
  const {riotId, region, mode, count, nextStart, hasMore} = input;
  if (typeof riotId !== 'string' || !riotId.trim() || riotId.length > 80 || identity(riotId) !== identity(history.profile.riotId)
    || typeof region !== 'string' || !REGIONS.has(region) || identity(history.profile.region) !== region
    || !['sr', 'mayhem'].includes(mode) || (modeOf(history) !== 'mixed' && mode !== modeOf(history))
    || ![10, 20].includes(count) || !Number.isInteger(nextStart) || nextStart < 0 || nextStart > MAX_MATCHES
    || typeof hasMore !== 'boolean' || (nextStart === MAX_MATCHES && hasMore)) fail('invalid_query');
  return {riotId:riotId.trim(), region, mode, count, nextStart, hasMore};
}

function checkedHistory(input) {
  try {return normalizeHistory(input);}
  catch {fail('invalid_history');}
}

function isOversized(text) {
  return text.length > MAX_JSON_LENGTH || new TextEncoder().encode(text).length > MAX_JSON_LENGTH;
}

function storageError(error) {
  return error?.name === 'QuotaExceededError' || error?.name === 'NS_ERROR_DOM_QUOTA_REACHED'
    ? 'storage_quota' : 'storage_unavailable';
}

// Device data is never promoted back to authenticated Riot provenance.
// Failed reads leave the saved bytes intact so a later recovery remains possible.
export function loadSavedHistory(storage) {
  try {
    const text = storageFor(storage)?.getItem(HISTORY_STORAGE_KEY);
    if (typeof text !== 'string' || isOversized(text)) return null;
    const snapshot = JSON.parse(text);
    if (!snapshot || snapshot.version !== SNAPSHOT_VERSION) return null;
    const history = checkedHistory(snapshot.history);
    return {history, query:cleanQuery(snapshot.query, history), source:'device'};
  } catch {return null;}
}

// Validation/serialization happens before the single atomic localStorage write.
// No automatic eviction or truncation: a failure preserves the previous snapshot.
export function saveHistorySnapshot(input, query = null, storage) {
  let text;
  try {
    const history = checkedHistory(input);
    text = JSON.stringify({version:SNAPSHOT_VERSION, history:exportHistory(history), query:cleanQuery(query, history)});
    if (isOversized(text)) fail('history_too_large');
  } catch (error) {
    return {ok:false, error:error instanceof HistoryStoreError ? error.code : 'invalid_history'};
  }
  try {
    const target = storageFor(storage);
    if (!target || typeof target.setItem !== 'function') fail('storage_unavailable');
    target.setItem(HISTORY_STORAGE_KEY, text);
    return {ok:true};
  } catch (error) {return {ok:false, error:storageError(error)};}
}

export function clearSavedHistory(storage) {
  try {
    const target = storageFor(storage);
    if (!target || typeof target.removeItem !== 'function') fail('storage_unavailable');
    target.removeItem(HISTORY_STORAGE_KEY);
    return {ok:true};
  } catch (error) {return {ok:false, error:storageError(error)};}
}

export function mergeHistoryPage(existing, incoming, {prependNew = false, allowMixed = false} = {}) {
  const previous = checkedHistory(existing);
  const next = checkedHistory(incoming);
  if (!previous.profile.riotId || !previous.profile.region
    || identity(previous.profile.riotId) !== identity(next.profile.riotId)
    || identity(previous.profile.region) !== identity(next.profile.region)) fail('account_mismatch');
  const previousMode = modeOf(previous), nextMode = modeOf(next);
  const permitsMixedRefresh = allowMixed && previousMode === 'mixed' && nextMode !== 'mixed';
  if (!permitsMixedRefresh && (previousMode === 'mixed' || previousMode !== nextMode)) fail('mode_mismatch');
  const refreshed = new Map(next.matches.map(match => [match.id, match]));
  for (const match of previous.matches) {
    const replacement = refreshed.get(match.id);
    if (replacement && (replacement.champion !== match.champion || replacement.queue !== match.queue
      || replacement.queueId !== match.queueId)) fail('match_conflict');
  }
  const ids = new Set(previous.matches.map(match => match.id));
  const updated = previous.matches.map(match => {
    const replacement = refreshed.get(match.id);
    return replacement ? {...replacement, notes:match.notes || replacement.notes} : match;
  });
  const added = next.matches.filter(match => !ids.has(match.id));
  // Dates take precedence when all are known; otherwise preserve the caller's page direction.
  const matches = prependNew ? [...added, ...updated] : [...updated, ...added];
  if (matches.length > MAX_MATCHES) fail('history_limit');
  return checkedHistory({...exportHistory(next), matches, details:{...previous.details, ...next.details}});
}
