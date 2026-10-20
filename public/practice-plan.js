// Five-game practice plans: pick up to two focus metrics from the coaching comparisons,
// record the player's current level, then judge the first five games played afterwards.
// Plans live in this browser only; they describe intent, not verified improvement.
import {COMPARISON_METRICS, matchMetrics} from './comparison.js';

const STORAGE_KEY = 'rift-review-practice-plan';
const PLAN_GAMES = 5;
const MAX_FOCUS = 2;
const IMPROVEMENT = 0.1;
const FINDING_METRICS = Object.freeze({
  survival: 'deathsPer30',
  farm: 'csPerMin',
  vision: 'visionPerMin',
  involvement: 'kp',
});
const metricInfo = id => COMPARISON_METRICS.find(metric => metric.id === id);
const known = value => typeof value === 'number' && Number.isFinite(value);
const mean = values => (values.length ? values.reduce((t, v) => t + v, 0) / values.length : null);

export function choosePlanFocus(comparison, findings = []) {
  const ids = [
    ...comparison.lane.metrics.filter(m => m.consistentlyBehind).map(m => m.id),
    ...(comparison.winLoss.available
      ? comparison.winLoss.metrics.filter(m => m.notable && m.favorsWins)
      : []
    ).map(m => m.id),
    ...(comparison.self.available ? comparison.self.metrics.filter(m => m.notable && !m.better) : []).map(
      m => m.id,
    ),
    ...findings.map(f => FINDING_METRICS[f.id]).filter(Boolean),
  ];
  return [...new Set(ids)].filter(id => metricInfo(id)).slice(0, MAX_FOCUS);
}

const accountOf = history => `${history.profile.riotId}|${history.profile.region}`;
const srMatches = history => history.matches.filter(match => match.queue !== 'ARAM Mayhem');
function average(matches, details, id) {
  const roles = metricInfo(id)?.roles;
  return mean(
    matches
      .filter(match => !roles || roles.includes(match.role))
      .map(match => matchMetrics(match, details?.[match.id]).you?.[id])
      .filter(known),
  );
}

export function createPlan(history, focusIds, now = new Date().toISOString()) {
  const matches = srMatches(history);
  const focus = focusIds.flatMap(id => {
    const info = metricInfo(id);
    const baseline = average(matches, history.details, id);
    if (!info || baseline === null) return [];
    const target = info.higherIsBetter ? baseline * (1 + IMPROVEMENT) : baseline * (1 - IMPROVEMENT);
    return [{id, higherIsBetter: info.higherIsBetter, baseline, target}];
  });
  return {
    version: 1,
    account: accountOf(history),
    createdAt: now,
    games: PLAN_GAMES,
    knownIds: matches.map(match => match.id),
    focus,
  };
}

export function evaluatePlan(plan, history) {
  if (!plan || plan.account !== accountOf(history)) return null;
  const known = new Set(plan.knownIds);
  // History is newest first, so the first games after the plan are at the end of the list.
  const fresh = srMatches(history).filter(match => !known.has(match.id));
  const window = fresh.slice(-plan.games);
  return {
    played: window.length,
    complete: window.length >= plan.games,
    focus: plan.focus.map(item => {
      const current = average(window, history.details, item.id);
      return {
        ...item,
        current,
        met: current === null ? null : item.higherIsBetter ? current >= item.target : current <= item.target,
      };
    }),
  };
}

function validPlan(value) {
  return (
    value &&
    value.version === 1 &&
    typeof value.account === 'string' &&
    typeof value.createdAt === 'string' &&
    Number.isInteger(value.games) &&
    Array.isArray(value.knownIds) &&
    value.knownIds.every(id => typeof id === 'string') &&
    Array.isArray(value.focus) &&
    value.focus.every(f => metricInfo(f?.id) && known(f.baseline) && known(f.target))
  );
}

export function loadPlan(storage = globalThis.localStorage) {
  try {
    const value = JSON.parse(storage?.getItem(STORAGE_KEY) ?? 'null');
    return validPlan(value) ? value : null;
  } catch {
    return null;
  }
}

export function savePlan(plan, storage = globalThis.localStorage) {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(plan));
    return true;
  } catch {
    return false;
  }
}

export function clearPlan(storage = globalThis.localStorage) {
  try {
    storage?.removeItem(STORAGE_KEY);
  } catch {
    // A plan that cannot be removed simply stays; nothing else depends on it.
  }
}
