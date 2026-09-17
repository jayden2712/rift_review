import {normalizeMatch, InputError} from './data.js';

export const QUEUES = ['Ranked Solo', 'Ranked Flex', 'Normal', 'Standard', 'ARAM', 'Other'];
const SUPPORTED = new Set(['Ranked Solo', 'Ranked Flex', 'Normal', 'Standard']);
export const MAX_MATCHES = 500;
export const MAX_JSON_LENGTH = 2000000;

function shortText(value, fallback, label, max = 80) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value !== 'string' || value.trim().length > max) throw new InputError([`${label}: tối đa ${max} ký tự.`]);
  return value.trim() || fallback;
}
export function normalizeHistory(input) {
  const envelope = Array.isArray(input) ? {matches: input} : input;
  if (!envelope || typeof envelope !== 'object') throw new InputError(['Nhập đối tượng có profile và matches, hoặc một mảng trận đấu.']);
  // Preserve the original single-match JSON input as a one-match history.
  const entries = envelope.matches ?? (envelope.champion ? [envelope] : null);
  if (!Array.isArray(entries) || !entries.length || entries.length > MAX_MATCHES) throw new InputError([`Lịch sử cần từ 1 đến ${MAX_MATCHES} trận.`]);
  const profile = envelope.profile ?? {};
  if (typeof profile !== 'object' || Array.isArray(profile)) throw new InputError(['profile phải là một đối tượng.']);
  const normalizedProfile = {
    riotId: shortText(profile.riotId, 'Hồ sơ của bạn', 'Riot ID'),
    region: shortText(profile.region, '', 'Khu vực', 30),
    rank: shortText(profile.rank, '', 'Rank', 60),
  };
  const ids = new Set();
  const errors = [];
  const matches = entries.map((entry, index) => {
    try {
      const match = normalizeMatch(entry, {allowShort: true});
      const id = shortText(entry.id, `import-${index + 1}`, 'Match ID', 200);
      if (ids.has(id)) throw new InputError([`Match ID bị trùng: ${id}. Xóa bản trùng để tránh tính hai lần.`]);
      ids.add(id);
      const queue = entry.queue ?? 'Standard';
      if (!QUEUES.includes(queue)) throw new InputError([`queue phải là ${QUEUES.join(', ')}.`]);
      let playedAt = null;
      if (entry.playedAt !== undefined && entry.playedAt !== null && entry.playedAt !== '') {
        if (typeof entry.playedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/.test(entry.playedAt) || !Number.isFinite(Date.parse(entry.playedAt))) throw new InputError(['playedAt cần ngày giờ ISO có múi giờ, ví dụ 2026-09-14T10:30:00Z.']);
        playedAt = new Date(entry.playedAt).toISOString();
      }
      if (entry.isRemake !== undefined && typeof entry.isRemake !== 'boolean') throw new InputError(['isRemake phải là true hoặc false.']);
      const extra = {};
      for (const key of ['damageToChampions', 'goldEarned']) {
        const value = entry[key];
        if (value === undefined || value === null || value === '') extra[key] = null;
        else if (!['number','string'].includes(typeof value) || !Number.isInteger(Number(value)) || Number(value) < 0 || Number(value) > 1000000) throw new InputError([`${key} cần số nguyên từ 0 đến 1.000.000, hoặc để trống.`]);
        else extra[key] = Number(value);
      }
      return {...match, ...extra, id, queue, playedAt, isRemake: entry.isRemake === true, inputIndex: index};
    } catch (error) {
      errors.push(`Trận ${index + 1}: ${error instanceof InputError ? error.messages.join(' ') : 'Dữ liệu không hợp lệ.'}`);
      return null;
    }
  });
  if (errors.length) throw new InputError(errors.slice(0, 8));
  const dated = matches.every(match => match.playedAt !== null);
  if (dated) matches.sort((a,b) => Date.parse(b.playedAt) - Date.parse(a.playedAt) || a.inputIndex - b.inputIndex);
  return {schemaVersion: 2, profile: normalizedProfile, matches, ordering: dated ? 'date' : 'input'};
}

export function exclusionReason(match) {
  if (match.isRemake || match.durationMinutes < 5) return 'Remake / dưới 5 phút';
  if (!SUPPORTED.has(match.queue)) return 'Chế độ ngoài Summoner’s Rift tiêu chuẩn';
  return null;
}

export const historyJsonSource = {
  id: 'history-json',
  async load(text) {
    if (typeof text !== 'string' || text.length > MAX_JSON_LENGTH) throw new InputError(['JSON cần nhỏ hơn 2 MB.']);
    let parsed;
    try { parsed = JSON.parse(text); }
    catch { throw new InputError(['JSON chưa hợp lệ. Kiểm tra dấu ngoặc, dấu phẩy và dấu nháy kép.']); }
    return normalizeHistory(parsed);
  },
};

// Provider boundary: an approved backend can return this same History v2 contract.
// No API credentials or calls to an undocumented OP.GG endpoint belong in the UI.
export const historyManualSource = {id: 'history-manual', async load(payload) {return normalizeHistory(payload);}};

export function exportHistory(history) {
  return {schemaVersion: 2, profile: history.profile, matches: history.matches.map(({inputIndex, ...match}) => match)};
}

// Fictional practice data, never tied to an actual Riot account or fetched on load.
export function sampleHistory(kind = 'mid') {
  const matches = [];
  const count = kind === 'support' ? 20 : 24;
  const champions = kind === 'support' ? ['Leona','Nautilus','Thresh'] : ['Ahri','Ahri','Orianna','Ahri','Syndra','Jinx'];
  for (let i=0; i<count; i++) {
    const champion = champions[i % champions.length];
    const role = kind === 'support' ? 'Support' : champion === 'Jinx' ? 'ADC' : 'Mid';
    const durationMinutes = [29,32,27,35,30,28][i % 6];
    const result = (i < 10 ? [true,true,false,true,false,true,true,false,true,true] : [false,true,false,false,true,false,true,false,false,true])[i % 10] ? 'Victory' : 'Defeat';
    const kills = role === 'Support' ? [1,2,0,3][i%4] : [8,6,4,9,3,7][i%6];
    const assists = role === 'Support' ? [17,22,13,18][i%4] : [9,8,7,12,5,10][i%6];
    const deaths = i<10 ? [3,5,7,4,8,3][i%6] : [8,6,9,7,10,5][i%6];
    matches.push({id:`demo-${kind}-${i+1}`, playedAt:new Date(Date.UTC(2026,8,14,19)-i*16*3600000).toISOString(),champion,role,result,queue:i%7===0?'Ranked Flex':'Ranked Solo',durationMinutes,kills,deaths,assists,cs:role==='Support' ? 28+i%20 : Math.round(durationMinutes*((i<10?6.4:5.3)+[0,.3,-.7,.8,-.3,.2][i%6])),visionScore:Math.round(durationMinutes*(role==='Support' ? [1.9,1.6,1.1,2.1][i%4] : [.7,.65,.38,.9,.42,.6][i%6])),teamKills:kills+assists+[7,9,12,5,14,8][i%6],damageToChampions:role==='Support'?8500+i*140:18000+(i%6)*1900,goldEarned:role==='Support'?9200+i*110:12500+(i%6)*450,notes:''});
  }
  return normalizeHistory({profile:{riotId:kind==='support'?'Support Lab#DEMO':'Jayden#DEMO',region:'OCE',rank:''},matches});
}
