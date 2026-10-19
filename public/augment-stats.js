// Descriptive ARAM Mayhem augment statistics. Augments only exist for matches imported from
// the League client, and every match carries all ten players, so two scopes are reported:
// the player's own picks and every participant's picks in the same games (a larger sample).
const validIds = augments =>
  Array.isArray(augments)
    ? augments.map(augment => augment?.id).filter(id => Number.isSafeInteger(id) && id > 0)
    : null;

function tally(counts, ids, won) {
  for (const id of new Set(ids)) {
    const row = counts.get(id) ?? {id, picks: 0, wins: 0};
    row.picks += 1;
    if (won) row.wins += 1;
    counts.set(id, row);
  }
}

const rows = counts =>
  [...counts.values()]
    .map(row => ({...row, winRate: row.wins / row.picks}))
    .sort((a, b) => b.picks - a.picks || b.winRate - a.winRate || a.id - b.id);

export function augmentStats(matches, details) {
  const self = new Map(),
    lobby = new Map();
  let selfGames = 0,
    lobbyGames = 0,
    lobbyPlayers = 0;
  for (const match of matches) {
    if (match.isRemake === true || !['Victory', 'Defeat'].includes(match.result)) continue;
    const participants = details?.[match.id]?.participants;
    const player = Array.isArray(participants) ? participants.find(p => p?.isPlayer) : null;
    if (!player) continue;
    const won = match.result === 'Victory';
    const own = validIds(player.augments);
    if (own) {
      selfGames += 1;
      tally(self, own, won);
    }
    let counted = false;
    for (const participant of participants) {
      const ids = validIds(participant?.augments);
      if (!ids || ![100, 200].includes(participant.teamId)) continue;
      counted = true;
      lobbyPlayers += 1;
      tally(lobby, ids, participant.teamId === player.teamId ? won : !won);
    }
    if (counted) lobbyGames += 1;
  }
  return {
    self: {games: selfGames, rows: rows(self)},
    lobby: {games: lobbyGames, players: lobbyPlayers, rows: rows(lobby)},
  };
}
