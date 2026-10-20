// Relative coaching signals for Summoner's Rift. Instead of fixed demo thresholds, each
// metric is compared with (1) the opposing laner in the same match, (2) the player's own
// earlier games in the main role and (3) the player's wins versus losses. Everything is
// descriptive: a difference shows where to look in replays, not what caused a result.

const ROLES = ['Top', 'Jungle', 'Mid', 'ADC', 'Support'];
const LANERS = ['Top', 'Mid', 'ADC'];
// `roles` limits a metric to positions where it describes the job; omitted means all.
// Metrics from `extra` come from MATCH-V5 challenges and are missing for older imports.
export const COMPARISON_METRICS = Object.freeze([
  {id: 'deathsPer30', higherIsBetter: false},
  {id: 'timeDeadShare', higherIsBetter: false},
  {id: 'csPerMin', higherIsBetter: true, roles: ['Top', 'Jungle', 'Mid', 'ADC']},
  {id: 'csAt10', higherIsBetter: true, roles: LANERS},
  {id: 'jungleCsAt10', higherIsBetter: true, roles: ['Jungle']},
  {id: 'goldPerMin', higherIsBetter: true},
  {id: 'damagePerMin', higherIsBetter: true},
  {id: 'damageShare', higherIsBetter: true},
  {id: 'kp', higherIsBetter: true},
  {id: 'soloKills', higherIsBetter: true, roles: ['Top', 'Mid']},
  {id: 'plates', higherIsBetter: true, roles: LANERS},
  {id: 'objectives', higherIsBetter: true, roles: ['Jungle', 'Support', 'Top', 'Mid', 'ADC']},
  {id: 'enemyJungleCamps', higherIsBetter: true, roles: ['Jungle']},
  {id: 'visionPerMin', higherIsBetter: true},
  {id: 'controlWardsPer30', higherIsBetter: true},
  {id: 'wardKillsPer30', higherIsBetter: true, roles: ['Jungle', 'Support']},
]);
const RECENT_GAMES = 5;
const MIN_GROUP = 5;
const MIN_WIN_LOSS = 3;
const CONSISTENT_SHARE = 0.6;
// Below these, a change is reported as "about the same" rather than better or worse.
const NOTABLE_CHANGE = 0.1;
const NOTABLE_EFFECT = 0.5;
// Role-specific metrics can have few games per side; only call them out with enough of each.
const NOTABLE_SIDE = 5;

const known = value => typeof value === 'number' && Number.isFinite(value);
const per = (value, minutes) => (known(value) && minutes > 0 ? value / minutes : null);
const mean = values => values.reduce((total, value) => total + value, 0) / values.length;
function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function teamTotals(participants, teamId) {
  const team = participants.filter(p => p.teamId === teamId);
  const sum = field =>
    team.length === 5 && team.every(p => known(p[field])) ? team.reduce((t, p) => t + p[field], 0) : null;
  return {kills: sum('kills'), damage: sum('damageToChampions')};
}

function playerMetrics(p, participants, minutes) {
  const totals = teamTotals(participants, p.teamId);
  const extra = p.extra && typeof p.extra === 'object' ? p.extra : {};
  const objectives = ['dragons', 'barons', 'heralds'].every(key => known(extra[key]))
    ? extra.dragons + extra.barons + extra.heralds
    : null;
  return {
    timeDeadShare: known(extra.timeDead) ? extra.timeDead / (minutes * 60) : null,
    csAt10: known(extra.laneCs10) ? extra.laneCs10 : null,
    jungleCsAt10: known(extra.jungleCs10) ? extra.jungleCs10 : null,
    soloKills: known(extra.soloKills) ? extra.soloKills : null,
    plates: known(extra.plates) ? extra.plates : null,
    objectives,
    enemyJungleCamps: known(extra.enemyJungleCamps) ? extra.enemyJungleCamps : null,
    controlWardsPer30: known(extra.controlWards) ? (extra.controlWards * 30) / minutes : null,
    wardKillsPer30: known(extra.wardTakedowns) ? (extra.wardTakedowns * 30) / minutes : null,
    deathsPer30: known(p.deaths) ? (p.deaths * 30) / minutes : null,
    csPerMin: per(p.cs, minutes),
    goldPerMin: per(p.goldEarned, minutes),
    damagePerMin: per(p.damageToChampions, minutes),
    damageShare: totals.damage > 0 && known(p.damageToChampions) ? p.damageToChampions / totals.damage : null,
    kp: totals.kills > 0 && known(p.kills) && known(p.assists) ? (p.kills + p.assists) / totals.kills : null,
    visionPerMin: per(p.visionScore, minutes),
  };
}

export function matchMetrics(match, detail) {
  const participants = Array.isArray(detail?.participants) ? detail.participants : [];
  const player = participants.find(p => p?.isPlayer);
  const minutes = known(detail?.durationSeconds) ? detail.durationSeconds / 60 : match.durationMinutes;
  if (!player || !(minutes > 0)) return {you: null, opponent: null, role: match.role};
  const role = ROLES.includes(player.role) ? player.role : match.role;
  const opponents = participants.filter(p => p.teamId !== player.teamId && p.role === role);
  return {
    role,
    you: playerMetrics(player, participants, minutes),
    opponent:
      ROLES.includes(role) && opponents.length === 1
        ? playerMetrics(opponents[0], participants, minutes)
        : null,
  };
}

const applies = (metric, role) => !metric.roles || metric.roles.includes(role);
const isBetter = (metric, a, b) => (metric.higherIsBetter ? a > b : a < b);

function laneComparison(rows) {
  const withOpponent = rows.filter(row => row.metrics.opponent);
  return {
    matches: withOpponent.length,
    metrics: COMPARISON_METRICS.map(metric => {
      const pairs = withOpponent.filter(
        row =>
          applies(metric, row.metrics.role) &&
          known(row.metrics.you[metric.id]) &&
          known(row.metrics.opponent[metric.id]),
      );
      const ahead = pairs.filter(row =>
        isBetter(metric, row.metrics.you[metric.id], row.metrics.opponent[metric.id]),
      ).length;
      const behind = pairs.filter(row =>
        isBetter(metric, row.metrics.opponent[metric.id], row.metrics.you[metric.id]),
      ).length;
      const total = pairs.length;
      return {
        id: metric.id,
        higherIsBetter: metric.higherIsBetter,
        total,
        ahead,
        behind,
        you: total ? mean(pairs.map(row => row.metrics.you[metric.id])) : null,
        opponent: total ? mean(pairs.map(row => row.metrics.opponent[metric.id])) : null,
        consistentlyAhead: total >= MIN_GROUP && ahead / total >= CONSISTENT_SHARE,
        consistentlyBehind: total >= MIN_GROUP && behind / total >= CONSISTENT_SHARE,
      };
    }),
  };
}

function selfComparison(rows) {
  const counts = new Map();
  for (const row of rows)
    if (ROLES.includes(row.match.role)) counts.set(row.match.role, (counts.get(row.match.role) ?? 0) + 1);
  const role = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
  const cohort = rows.filter(row => row.match.role === role && row.metrics.you);
  const recent = cohort.slice(0, RECENT_GAMES),
    baseline = cohort.slice(RECENT_GAMES);
  if (recent.length < RECENT_GAMES || baseline.length < MIN_GROUP)
    return {available: false, role, recentN: recent.length, baselineN: baseline.length};
  const values = (list, id) => list.map(row => row.metrics.you[id]).filter(known);
  return {
    available: true,
    role,
    recentN: recent.length,
    baselineN: baseline.length,
    metrics: COMPARISON_METRICS.filter(metric => applies(metric, role)).flatMap(metric => {
      const before = values(baseline, metric.id),
        after = values(recent, metric.id);
      if (before.length < MIN_GROUP || after.length < 3) return [];
      const typical = median(before),
        current = median(after);
      const change = typical === 0 ? (current === 0 ? 0 : 1) : (current - typical) / Math.abs(typical);
      return [
        {
          id: metric.id,
          higherIsBetter: metric.higherIsBetter,
          typical,
          recent: current,
          change,
          notable: Math.abs(change) >= NOTABLE_CHANGE,
          better: isBetter(metric, current, typical),
        },
      ];
    }),
  };
}

function winLossComparison(rows) {
  const wins = rows.filter(row => row.match.result === 'Victory' && row.metrics.you);
  const losses = rows.filter(row => row.match.result === 'Defeat' && row.metrics.you);
  if (wins.length < MIN_WIN_LOSS || losses.length < MIN_WIN_LOSS)
    return {available: false, wins: wins.length, losses: losses.length};
  const metrics = COMPARISON_METRICS.flatMap(metric => {
    const pick = list =>
      list
        .filter(row => applies(metric, row.metrics.role))
        .map(row => row.metrics.you[metric.id])
        .filter(known);
    const w = pick(wins),
      l = pick(losses);
    if (w.length < MIN_WIN_LOSS || l.length < MIN_WIN_LOSS) return [];
    const win = mean(w),
      loss = mean(l);
    const variance = list => {
      const m = mean(list);
      return list.reduce((total, value) => total + (value - m) ** 2, 0) / Math.max(1, list.length - 1);
    };
    const pooled = Math.sqrt((variance(w) + variance(l)) / 2);
    // Standardised difference, so metrics on different scales can be ranked together.
    const effect = pooled > 0 ? (win - loss) / pooled : win === loss ? 0 : Math.sign(win - loss) * 10;
    return [
      {
        id: metric.id,
        higherIsBetter: metric.higherIsBetter,
        win,
        loss,
        effect,
        notable: Math.abs(effect) >= NOTABLE_EFFECT && w.length >= NOTABLE_SIDE && l.length >= NOTABLE_SIDE,
        favorsWins: isBetter(metric, win, loss),
      },
    ];
  }).sort((a, b) => Math.abs(b.effect) - Math.abs(a.effect));
  return {available: true, wins: wins.length, losses: losses.length, metrics};
}

export function compareHistory({matches, details}) {
  const rows = matches.map(match => ({match, metrics: matchMetrics(match, details?.[match.id])}));
  const covered = rows.filter(row => row.metrics.you);
  return {
    coverage: {withDetail: covered.length, total: rows.length},
    lane: laneComparison(covered),
    self: selfComparison(covered),
    winLoss: winLossComparison(covered),
  };
}
