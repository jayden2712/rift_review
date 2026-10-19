// Maps League client (LCU) match-history games to History v3. Shapes verified against
// a live client on 2026-10-20; see docs/plans/lcu-mayhem-import.md and the fixture.
import {RiotError} from './riot.js';

const MAYHEM_QUEUE = 2400;
const AUGMENT_SLOTS = 6;
const integer = value => (Number.isInteger(value) && value >= 0 ? value : null);
const positiveId = value => (integer(value) > 0 ? value : null);
const badData = message => new RiotError('LCU_BAD_DATA', message, 502);

// Riot match data names champions by alias (MonkeyKing), which the app's icons also use.
export function championNames(summary) {
  const names = new Map();
  if (!Array.isArray(summary)) return names;
  for (const champion of summary) {
    if (positiveId(champion?.id) && typeof champion.alias === 'string' && champion.alias) {
      names.set(champion.id, champion.alias);
    }
  }
  return names;
}

function augments(stats) {
  const ids = Array.from({length: AUGMENT_SLOTS}, (_, i) => positiveId(stats['playerAugment' + (i + 1)]));
  return ids.filter(Boolean).map(id => ({id}));
}

// Mayhem games carry no runes (every perk is 0); keep null rather than an empty page.
function runes(stats) {
  const primaryStyle = positiveId(stats.perkPrimaryStyle);
  if (!primaryStyle) return null;
  const perks = Array.from({length: 6}, (_, i) => positiveId(stats['perk' + i]));
  return {
    primaryStyle,
    secondaryStyle: positiveId(stats.perkSubStyle),
    primary: perks.slice(0, 4),
    secondary: perks.slice(4, 6),
    shards: [null, null, null],
  };
}

function participantView(participant, identity, selfPuuid, champions) {
  const stats = participant.stats;
  const player = identity?.player ?? {};
  return {
    championLevel: positiveId(stats.champLevel),
    summonerSpells: [positiveId(participant.spell1Id), positiveId(participant.spell2Id)],
    items: Array.from({length: 7}, (_, i) => integer(stats['item' + i])),
    runes: runes(stats),
    augments: augments(stats),
    riotId: player.gameName && player.tagLine ? `${player.gameName}#${player.tagLine}` : '',
    champion: champions.get(participant.championId) ?? 'Chưa rõ',
    role: null,
    teamId: participant.teamId,
    isPlayer: player.puuid === selfPuuid,
    kills: integer(stats.kills),
    deaths: integer(stats.deaths),
    assists: integer(stats.assists),
    cs:
      integer(stats.totalMinionsKilled) !== null && integer(stats.neutralMinionsKilled) !== null
        ? stats.totalMinionsKilled + stats.neutralMinionsKilled
        : null,
    damageToChampions: integer(stats.totalDamageDealtToChampions),
    goldEarned: integer(stats.goldEarned),
    visionScore: integer(stats.visionScore),
  };
}

function validGame(game) {
  return (
    game &&
    typeof game === 'object' &&
    Number.isSafeInteger(game.gameId) &&
    typeof game.platformId === 'string' &&
    /^[A-Z0-9]{2,5}$/.test(game.platformId) &&
    Array.isArray(game.participants) &&
    Array.isArray(game.participantIdentities) &&
    game.participants.length <= 10 &&
    game.participants.every(p => p && typeof p === 'object' && p.stats && typeof p.stats === 'object')
  );
}

export function mapLcuGame(game, selfPuuid, champions) {
  if (!validGame(game)) throw badData('Dữ liệu trận từ client LoL không hợp lệ.');
  if (game.queueId !== MAYHEM_QUEUE) return {skipped: 'Trận không thuộc ARAM Mayhem (queue 2400)'};
  const identities = new Map(game.participantIdentities.map(identity => [identity?.participantId, identity]));
  const selfIds = game.participantIdentities.filter(identity => identity?.player?.puuid === selfPuuid);
  if (selfIds.length !== 1)
    throw new RiotError('PLAYER_MISMATCH', 'Trận từ client không chứa đúng tài khoản đang đăng nhập.', 502);
  const player = game.participants.find(p => p.participantId === selfIds[0].participantId);
  if (!player) throw badData('Thiếu dữ liệu người chơi trong trận.');
  const duration = integer(game.gameDuration);
  if (!duration || duration > 10800) return {skipped: 'Thiếu thời lượng trận'};
  const stats = player.stats;
  if (
    typeof stats.win !== 'boolean' ||
    ['kills', 'deaths', 'assists'].some(key => integer(stats[key]) === null)
  )
    throw badData('Thiếu kết quả hoặc KDA của người chơi.');
  const participants = game.participants
    .map(p => participantView(p, identities.get(p.participantId), selfPuuid, champions))
    .sort((a, b) => a.teamId - b.teamId);
  const self = participants.find(p => p.isPlayer);
  const teammates = game.participants.filter(p => p.teamId === player.teamId);
  const teamKills = teammates.every(p => integer(p.stats.kills) !== null)
    ? teammates.reduce((total, p) => total + p.stats.kills, 0)
    : null;
  const created = integer(game.gameCreation);
  return {
    match: {
      id: `${game.platformId}_${game.gameId}`,
      playedAt: created === null || created > 8640000000000000 ? null : new Date(created).toISOString(),
      champion: self.champion,
      role: null,
      result: stats.win ? 'Victory' : 'Defeat',
      queue: 'ARAM Mayhem',
      durationMinutes: duration / 60,
      kills: stats.kills,
      deaths: stats.deaths,
      assists: stats.assists,
      cs: self.cs,
      visionScore: self.visionScore,
      teamKills: teamKills !== null && teamKills >= stats.kills + stats.assists ? teamKills : null,
      damageToChampions: self.damageToChampions,
      goldEarned: self.goldEarned,
      notes: '',
      isRemake: null,
    },
    detail: {
      durationSeconds: duration,
      gameVersion: typeof game.gameVersion === 'string' ? game.gameVersion : '',
      participants,
    },
  };
}
