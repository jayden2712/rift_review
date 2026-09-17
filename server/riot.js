// Server-only Riot client. Never include this module or API secrets in browser assets.
export const RIOT_REGIONS = Object.freeze({
  oce:{platform:'oc1',routing:'sea',label:'OCE'}, vn:{platform:'vn2',routing:'sea',label:'VN'},
  kr:{platform:'kr',routing:'asia',label:'KR'}, jp:{platform:'jp1',routing:'asia',label:'JP'},
  na:{platform:'na1',routing:'americas',label:'NA'}, br:{platform:'br1',routing:'americas',label:'BR'},
  lan:{platform:'la1',routing:'americas',label:'LAN'}, las:{platform:'la2',routing:'americas',label:'LAS'},
  euw:{platform:'euw1',routing:'europe',label:'EUW'}, eune:{platform:'eun1',routing:'europe',label:'EUNE'},
  tr:{platform:'tr1',routing:'europe',label:'TR'}, ru:{platform:'ru',routing:'europe',label:'RU'},
  sg:{platform:'sg2',routing:'sea',label:'SG'}, tw:{platform:'tw2',routing:'sea',label:'TW'},
});
export class RiotError extends Error {
  constructor(code,message,status=502,retryAfter=0){super(message);this.name='RiotError';this.code=code;this.status=status;this.retryAfter=retryAfter;}
}
export function parseLookup(input) {
  if(!input||typeof input!=='object')throw new RiotError('INVALID_INPUT','Nhập Riot ID và chọn server.',400);
  const riotId=typeof input.riotId==='string'?input.riotId.trim().normalize('NFC'):'';
  const parts=riotId.split('#');
  if(parts.length!==2||!parts[0].trim()||!parts[1].trim()||riotId.length>100||/[\u0000-\u001f\u007f]/u.test(riotId))throw new RiotError('INVALID_ID','Riot ID cần dạng Tên#TAG. Giữ đúng dấu và khoảng trắng.',400);
  const region=typeof input.region==='string'?input.region.toLowerCase():'';
  if(!RIOT_REGIONS[region])throw new RiotError('INVALID_REGION','Chọn server của tài khoản League of Legends.',400);
  const count=input.count===undefined?20:Number(input.count);
  if(![10,20].includes(count))throw new RiotError('INVALID_COUNT','Mỗi lần tra cứu lấy 10 hoặc 20 trận gần nhất.',400);
  return {gameName:parts[0].trim(),tagLine:parts[1].trim(),region,count};
}

const routeState=new Map();
const sleepDefault=milliseconds=>new Promise(resolve=>setTimeout(resolve,milliseconds));
export function createRiotClient({key,origin,cache=null,fetchImpl=fetch,sleep=sleepDefault,now=Date.now,state=routeState}) {
  if(typeof key!=='string'||!key.trim())throw new RiotError('RIOT_NOT_CONFIGURED','Chưa cấu hình Riot API key trên máy chủ.',503);
  const secret=key.trim();
  let networkRequests=0,cacheHits=0;
  async function reserve(route) {
    let s=state.get(route);if(!s){s={calls:[],next:0,blockedUntil:0};state.set(route,s);}
    const time=now();
    if(s.blockedUntil>time)throw new RiotError('RIOT_RATE_LIMIT','Riot đang giới hạn yêu cầu. Thử lại sau thời gian được hiển thị.',429,Math.ceil((s.blockedUntil-time)/1000));
    s.calls=s.calls.filter(t=>t>time-120000);
    if(s.calls.length>=90)throw new RiotError('LOCAL_RATE_LIMIT','Đã gần giới hạn Riot API. Các trận lấy được đã được lưu tạm; hãy thử lại sau.',429,Math.max(1,Math.ceil((s.calls[0]+120000-time)/1000)));
    const slot=Math.max(time,s.next);s.next=slot+160;s.calls.push(slot);
    if(slot-time>2000)throw new RiotError('LOOKUP_BUSY','Có yêu cầu khác đang tải. Vui lòng đợi vài giây rồi thử lại.',429,3);
    if(slot>time)await sleep(slot-time);
  }
  async function get(route,path,ttl=120,attempt=0) {
    if(!['asia','sea','europe','americas',...Object.values(RIOT_REGIONS).map(r=>r.platform)].includes(route)||!path.startsWith('/')||path.includes('://'))throw new RiotError('INVALID_ROUTE','Đường dẫn dữ liệu không hợp lệ.',500);
    const cacheKey=new Request(`${origin}/__riot_cache_v1/${route}${path}`);
    if(cache){try{const saved=await cache.match(cacheKey);if(saved){cacheHits++;return await saved.json();}}catch{/* Cache failure falls back to a bounded Riot request. */}}
    await reserve(route);
    let response;
    try{networkRequests++;response=await fetchImpl(`https://${route}.api.riotgames.com${path}`,{headers:{'X-Riot-Token':secret,'Accept':'application/json'},redirect:'error',signal:AbortSignal.timeout(15000)});}
    catch{throw new RiotError('RIOT_UNAVAILABLE','Không kết nối được Riot. Dữ liệu đang xem vẫn được giữ nguyên. Thử lại sau.',502);}
    if(response.status===429){
      const raw=response.headers.get('Retry-After');
      const seconds=raw&&/^\d+(?:\.\d+)?$/.test(raw)?Math.max(1,Math.ceil(Number(raw))):raw&&Number.isFinite(Date.parse(raw))?Math.max(1,Math.ceil((Date.parse(raw)-now())/1000)):120;
      state.get(route).blockedUntil=now()+seconds*1000;
      throw new RiotError('RIOT_RATE_LIMIT','Riot giới hạn số yêu cầu. Hãy đợi rồi tra cứu lại.',429,seconds);
    }
    if(response.status===401||response.status===403)throw new RiotError('RIOT_KEY_REJECTED','Riot không chấp nhận API key hiện tại. Cần cập nhật key trong phần cấu hình máy chủ.',502);
    if(response.status===404)throw new RiotError('RIOT_NOT_FOUND','Không tìm thấy tài khoản hoặc trận trên server đã chọn.',404);
    if(response.status>=500&&attempt===0){await sleep(600);return get(route,path,ttl,1);}
    if(!response.ok)throw new RiotError('RIOT_RESPONSE_ERROR',`Riot chưa trả được dữ liệu (HTTP ${response.status}). Thử lại sau.`,502);
    let payload;try{payload=await response.json();}catch{throw new RiotError('RIOT_BAD_DATA','Riot trả dữ liệu không đọc được. Thử lại sau.',502);}
    if(cache){try{await cache.put(cacheKey,new Response(JSON.stringify(payload),{headers:{'Content-Type':'application/json','Cache-Control':`public, max-age=${ttl}`}}));}catch{/* Optional cache is not a data store. */}}
    return payload;
  }
  return {get,stats:()=>({networkRequests,cacheHits})};
}

const roleNames={TOP:'Top',JUNGLE:'Jungle',MIDDLE:'Mid',BOTTOM:'ADC',UTILITY:'Support'};
const queues={420:'Ranked Solo',440:'Ranked Flex',400:'Normal',430:'Normal',490:'Normal'};
const finite=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0?value:null;
const integer=value=>Number.isInteger(value)&&value>=0?value:null;
function participantView(p,targetPuuid) {
  return {riotId:p.riotIdGameName&&p.riotIdTagline?`${p.riotIdGameName}#${p.riotIdTagline}`:'',champion:typeof p.championName==='string'?p.championName:'Chưa rõ',role:roleNames[p.teamPosition]||roleNames[p.individualPosition]||'Chưa rõ',teamId:p.teamId,isPlayer:p.puuid===targetPuuid,kills:integer(p.kills),deaths:integer(p.deaths),assists:integer(p.assists),cs:integer(p.totalMinionsKilled)!==null&&integer(p.neutralMinionsKilled)!==null?p.totalMinionsKilled+p.neutralMinionsKilled:null,damageToChampions:integer(p.totalDamageDealtToChampions),goldEarned:integer(p.goldEarned),visionScore:integer(p.visionScore)};
}
export function mapRiotMatch(raw,puuid,expectedId) {
  if(!raw?.info||raw.metadata?.matchId!==expectedId||!Array.isArray(raw.info.participants))throw new RiotError('RIOT_BAD_DATA','Cấu trúc trận từ Riot không hợp lệ.',502);
  const info=raw.info;
  if(info.mapId!==11||!queues[info.queueId])return {skipped:'Chế độ ngoài Summoner’s Rift tiêu chuẩn'};
  const player=info.participants.find(p=>p.puuid===puuid);
  if(!player)throw new RiotError('PLAYER_MISMATCH','Riot trả trận không chứa đúng tài khoản đã tra cứu.',502);
  if(info.participants.filter(p=>p.puuid===puuid).length!==1)throw new RiotError('PLAYER_MISMATCH','Dữ liệu định danh người chơi không nhất quán.',502);
  const duration=finite(info.gameDuration);
  if(duration===null||duration<=0)return {skipped:'Thiếu thời lượng trận'};
  if(duration<300)return {skipped:'Remake / trận kết thúc quá sớm'};
  if(duration>5400)return {skipped:'Trận dài hơn phạm vi 90 phút hiện tại'};
  const role=roleNames[player.teamPosition]||roleNames[player.individualPosition];
  if(!role)return {skipped:'Riot chưa xác định vị trí chơi'};
  if(typeof player.win!=='boolean'||['kills','deaths','assists'].some(field=>integer(player[field])===null))throw new RiotError('RIOT_BAD_DATA','Thiếu kết quả hoặc KDA của người chơi.',502);
  const self=participantView(player,puuid);
  const teammates=info.participants.filter(p=>p.teamId===player.teamId);
  const teamKills=teammates.length===5&&teammates.every(p=>integer(p.kills)!==null)?teammates.reduce((total,p)=>total+p.kills,0):null;
  const played=finite(info.gameStartTimestamp)??finite(info.gameCreation);
  const match={id:expectedId,playedAt:played===null?null:new Date(played).toISOString(),champion:self.champion,role,result:player.win?'Victory':'Defeat',queue:queues[info.queueId],durationMinutes:duration/60,kills:player.kills,deaths:player.deaths,assists:player.assists,cs:self.cs,visionScore:self.visionScore,teamKills:teamKills!==null&&teamKills>=player.kills+player.assists?teamKills:null,damageToChampions:self.damageToChampions,goldEarned:self.goldEarned,notes:'',isRemake:false};
  const participants=info.participants.map(p=>participantView(p,puuid)).sort((a,b)=>a.teamId-b.teamId);
  return {match,detail:{gameVersion:typeof info.gameVersion==='string'?info.gameVersion:'',participants}};
}

export async function loadRiotHistory(input,client) {
  const query=parseLookup(input),region=RIOT_REGIONS[query.region];
  // ACCOUNT-V1 is globally replicated; its supported clusters do not include SEA.
  const account=await client.get('asia',`/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(query.gameName)}/${encodeURIComponent(query.tagLine)}`,600);
  if(typeof account?.puuid!=='string'||!account.puuid)throw new RiotError('RIOT_BAD_ACCOUNT','Riot chưa trả mã định danh của tài khoản.',502);
  const puuid=account.puuid;
  try{await client.get(region.platform,`/lol/summoner/v4/summoners/by-puuid/${encodeURIComponent(puuid)}`,600);}
  catch(error){if(error.code==='RIOT_NOT_FOUND')throw new RiotError('WRONG_SERVER','Riot ID tồn tại nhưng không tìm thấy hồ sơ LoL trên server này. Hãy kiểm tra server.',404);throw error;}
  const ids=await client.get(region.routing,`/lol/match/v5/matches/by-puuid/${encodeURIComponent(puuid)}/ids?start=0&count=${query.count}`,120);
  if(!Array.isArray(ids)||ids.some(id=>typeof id!=='string'||!/^[A-Z0-9]+_\d+$/.test(id)))throw new RiotError('RIOT_BAD_LIST','Danh sách trận từ Riot không hợp lệ.',502);
  const matches=[],details={},warnings=[];
  for(const id of [...new Set(ids)].slice(0,query.count)) {
    let raw;
    try{raw=await client.get(region.routing,`/lol/match/v5/matches/${encodeURIComponent(id)}`,86400);}
    catch(error){if(error.code==='RIOT_NOT_FOUND'){warnings.push({id,reason:'Riot chưa cung cấp chi tiết trận'});continue;}throw error;}
    const mapped=mapRiotMatch(raw,puuid,id);
    if(mapped.skipped)warnings.push({id,reason:mapped.skipped});
    else{matches.push(mapped.match);details[id]=mapped.detail;}
  }
  if(!ids.length)throw new RiotError('NO_MATCHES','Tài khoản chưa có lịch sử trận mà Riot trả về ở khu vực này.',404);
  if(!matches.length)throw new RiotError('NO_SUPPORTED_MATCHES',`${ids.length} trận gần nhất chưa có trận Summoner’s Rift phù hợp để đánh giá.`,422);
  return {history:{schemaVersion:2,profile:{riotId:`${account.gameName||query.gameName}#${account.tagLine||query.tagLine}`,region:region.label,rank:''},matches},details,warnings,source:{provider:'riot',requested:query.count,returned:ids.length,included:matches.length,loadedAt:new Date().toISOString(),...client.stats()}};
}
