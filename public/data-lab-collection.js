import {DataLabInputError} from './data-lab-raw.js';
export const LAB_COLLECTION_CODES = [
  'RIOT_NOT_FOUND',
  'RIOT_AUTH_FAILED',
  'RIOT_ACCESS_DENIED',
  'RIOT_RATE_LIMIT',
  'LOCAL_RATE_LIMIT',
  'LOOKUP_BUSY',
  'RIOT_TIMEOUT',
  'RIOT_UNAVAILABLE',
  'RIOT_BAD_DATA',
  'RIOT_RESPONSE_ERROR',
  'INVALID_LAB_DATA',
];
const fail = () => {
  throw new DataLabInputError('Invalid Data Lab collection report.');
};
const ids = value => {
  if (
    !Array.isArray(value) ||
    value.length > 20 ||
    new Set(value).size !== value.length ||
    value.some(id => typeof id !== 'string' || !/^[A-Z0-9]+_\d{1,20}$/.test(id))
  )
    fail();
  return [...value];
};
export function readLabCollection(value) {
  if (value == null) return null;
  if (typeof value !== 'object' || Array.isArray(value)) fail();
  const requestedIds = ids(value.requestedIds),
    notAttemptedIds = ids(value.notAttemptedIds);
  const counts = Object.fromEntries(
    ['requested', 'attempted', 'succeeded', 'failed', 'notAttempted', 'coachingEligible'].map(key => {
      if (!Number.isInteger(value[key]) || value[key] < 0 || value[key] > 20) fail();
      return [key, value[key]];
    }),
  );
  if (
    counts.attempted !== counts.succeeded + counts.failed ||
    counts.requested !== counts.attempted + counts.notAttempted
  )
    fail();
  if (
    typeof value.region !== 'string' ||
    !/^[a-z]{2,4}$/.test(value.region) ||
    typeof value.playerPuuid !== 'string' ||
    !value.playerPuuid ||
    value.playerPuuid.length > 128 ||
    /[\u0000-\u001f\u007f]|RGAPI-/i.test(value.playerPuuid)
  )
    fail();
  if (!Array.isArray(value.failures) || value.failures.length > 20) fail();
  const failures = value.failures.map(error => {
    if (
      !error ||
      !requestedIds.includes(error.matchId) ||
      !LAB_COLLECTION_CODES.includes(error.code) ||
      !Number.isInteger(error.status) ||
      error.status < 400 ||
      error.status > 599 ||
      typeof error.retryable !== 'boolean'
    )
      fail();
    return {matchId: error.matchId, code: error.code, status: error.status, retryable: error.retryable};
  });
  if (
    new Set(failures.map(error => error.matchId)).size !== failures.length ||
    notAttemptedIds.some(id => !requestedIds.includes(id))
  )
    fail();
  return {
    ...counts,
    requestedIds,
    notAttemptedIds,
    failures,
    region: value.region,
    playerPuuid: value.playerPuuid,
  };
}
