import {t,getLanguage,getLocale} from './i18n.js';
import {championAvatar} from './champion-icons.js';
import {gameAsset} from './game-assets.js';

const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const number=value=>Number.isFinite(value)?new Intl.NumberFormat(getLocale()).format(value):'—';
const fixed=value=>Number.isFinite(value)?value.toFixed(1):'—';
const ids=(value,count)=>Array.from({length:count},(_,i)=>{
  const id=Array.isArray(value)?value[i]:null;
  return Number.isSafeInteger(id)&&id>=0?id:null;
});

export function formatDuration(minutes,seconds=null){
  const value=Number.isFinite(seconds)&&seconds>=0?seconds:Number.isFinite(minutes)&&minutes>=0?minutes*60:null;
  if(value===null)return '—';
  const total=Math.round(value);
  return String(Math.floor(total/60)).padStart(2,'0')+'m'+String(total%60).padStart(2,'0')+'s';
}

export function matchPlayer(detail){
  return Array.isArray(detail?.participants)?detail.participants.slice(0,10).find(p=>p?.isPlayer)||null:null;
}

function icon(kind,id,className='game-icon'){
  const valid=Number.isSafeInteger(id)&&id>0;
  const asset=valid?gameAsset(kind,id,getLanguage()):null;
  const empty=kind==='item'&&id===0;
  const title=asset?.name||(empty?t('Ô trang bị trống'):valid?t('Chưa có icon · ID {id}',{id}):t('Chưa có dữ liệu'));
  const image=asset?`<img data-game-icon src="${escape(asset.src)}" alt="" width="32" height="32" loading="lazy" decoding="async">`:'';
  return `<span class="${className}${empty?' is-empty':''}" title="${escape(title)}" role="img" aria-label="${escape(title)}"><span class="game-icon-fallback" aria-hidden="true">${empty?'':valid?'·':'?'}</span>${image}</span>`;
}

export function renderItemSlots(player){
  return `<span class="equipment-row" role="group" aria-label="${escape(t('Trang bị cuối trận'))}">${ids(player?.items,7).map((id,i)=>icon('item',id,'equipment-slot'+(i===6?' trinket-slot':''))).join('')}</span>`;
}

export function renderSpells(player){
  return `<span class="spell-pair" role="group" aria-label="${escape(t('Phép bổ trợ'))}">${ids(player?.summonerSpells,2).map(id=>icon('spell',id)).join('')}</span>`;
}

function compactRunes(player){
  const primary=ids(player?.runes?.primary,1)[0];
  const secondary=ids([player?.runes?.secondaryStyle],1)[0];
  return `<span class="rune-pair" role="group" aria-label="${escape(t('Ngọc siêu cấp và nhánh phụ'))}">${icon('rune',primary)}${icon('rune',secondary)}</span>`;
}

function runeEntry(id){
  const name=gameAsset('rune',id,getLanguage())?.name||(id?t('Ngọc ID {id}',{id}):t('Chưa có dữ liệu'));
  return `<span class="rune-selection">${icon('rune',id)}<span>${escape(name)}</span></span>`;
}

export function renderRunePage(player){
  const runes=player?.runes;
  const path=(label,style,selections,count)=>`<div class="rune-path"><h4>${label}</h4><div class="rune-path-name">${runeEntry(ids([style],1)[0])}</div><div class="rune-selections">${ids(selections,count).map(runeEntry).join('')}</div></div>`;
  return `<section class="rune-page"><div class="loadout-heading"><h3>${t('Bảng ngọc')}</h3><span>${runes?t('Lựa chọn trong trận'):t('Chưa có dữ liệu ngọc cho trận này')}</span></div><div class="rune-paths">${path(t('Ngọc chính'),runes?.primaryStyle,runes?.primary,4)}${path(t('Ngọc phụ'),runes?.secondaryStyle,runes?.secondary,2)}<div class="rune-path stat-shards"><h4>${t('Mảnh chỉ số')}</h4><div class="rune-selections">${ids(runes?.shards,3).map(runeEntry).join('')}</div></div></div></section>`;
}

function hasRuneData(player){
  const runes=player?.runes;
  return [runes?.primaryStyle,runes?.secondaryStyle,...ids(runes?.primary,4),...ids(runes?.secondary,2),...ids(runes?.shards,3)].some(id=>Number.isSafeInteger(id)&&id>0);
}

function unavailableRunes(){
  return `<section class="rune-page"><div class="loadout-heading"><h3>${t('Bảng ngọc')}</h3><span>${t('Chưa có dữ liệu ngọc cho trận này')}</span></div></section>`;
}

function unavailableAugments(){
  return `<section class="mayhem-augments"><div class="loadout-heading"><h3>${t('Nâng cấp (Augments)')}</h3><span>${t('Chưa xác minh dữ liệu nâng cấp cho trận này')}</span></div></section>`;
}

export function renderLoadout(player,options={}){
  return `<section class="match-loadout-detail"><div class="loadout-heading"><h3>${t('Bộ trang bị & phép bổ trợ')}</h3><span>${player?t('Trang bị tại thời điểm kết thúc trận'):t('Chưa có dữ liệu — tra cứu Riot để xem')}</span></div><div class="loadout-inventory">${renderItemSlots(player)}${renderSpells(player)}</div>${options.mayhem&&!hasRuneData(player)?unavailableRunes():renderRunePage(player)}${options.mayhem?unavailableAugments():''}</section>`;
}

function roster(detail){
  const participants=Array.isArray(detail?.participants)?detail.participants.filter(p=>p&&typeof p==='object').slice(0,10):[];
  if(!participants.length)return `<span class="card-roster-empty">${t('Đội hình')}<br><span>${t('Chưa có dữ liệu')}</span></span>`;
  return `<span class="card-rosters" aria-label="${escape(t('Đội hình hai đội'))}">${[100,200].map(team=>`<span class="card-roster roster-${team===100?'blue':'red'}">${participants.filter(p=>p.teamId===team).slice(0,5).map(p=>`<span class="roster-player ${p.isPlayer?'is-you':''}" title="${escape(p.riotId||p.champion)}">${championAvatar(p.champion,true)}<span>${escape((p.riotId||p.champion||t('Chưa rõ')).split('#')[0])}</span></span>`).join('')}</span>`).join('')}</span>`;
}

export function renderLobbyRank(match,rankState,source){
  if(match.queue==='ARAM Mayhem')return '';
  const rank=rankState?.lobbyRank;
  const rankedQueue=['Ranked Solo','Ranked Flex'].includes(match.queue);
  if(rank?.label&&['available','partial'].includes(rank.status)){
    const asset=gameAsset('rank',rank.tier,getLanguage());
    const coverage=Number.isInteger(rank.rankedCount)&&Number.isInteger(rank.totalPlayers)?rank.rankedCount+'/'+rank.totalPlayers:'—';
    return `<span class="lobby-rank" title="${escape(t('Trung bình rank của người chơi có xếp hạng, không phải MMR hay rank tại thời điểm trận đấu'))}">${asset?`<img data-game-icon src="${escape(asset.src)}" alt="" width="25" height="25" loading="lazy">`:''}<span><strong>${escape(rank.label)}</strong><span>${source==='sample'?t('Rank mẫu'):rank.status==='partial'?t('TB rank đã biết · hiện tại'):t('TB lobby · hiện tại')} · ${coverage}</span></span></span>`;
  }
  if(source!=='riot'||!rankedQueue)return `<span class="lobby-rank rank-unavailable"><span>${t('Rank lobby')}</span><strong>${rankedQueue?t('Chưa có dữ liệu'):t('Không áp dụng')}</strong></span>`;
  if(rankState?.loading)return `<span class="lobby-rank rank-loading" role="status">${t('Đang tải rank…')}</span>`;
  const reason=rank?.reason==='NO_RANK_DATA'?t('Chưa đủ dữ liệu để xác định rank lobby.'):rank?.reason==='UNSUPPORTED_QUEUE'?t('Chế độ này không có rank lobby.'):rank?.reason==='NO_RANKED_PLAYERS'?t('Chưa có người chơi được xếp hạng.'):null;
  const message=rankState?.error||reason||(rank?.status==='unavailable'?t('Chưa có dữ liệu rank'):t('Rank hiện tại của người chơi'));
  return `<span class="lobby-rank rank-pending"><button type="button" class="rank-load-button" data-load-rank="${escape(match.id)}">${rankState?.error?t('Thử lại rank'):t('Xem rank lobby')}</button><span class="${rankState?.error?'rank-error':''}">${escape(message)}</span></span>`;
}

export function renderMatchSummary({match,metrics={},detail=null,rankState=null,source='json',dateLabel=''}){
  const mayhem=match.queue==='ARAM Mayhem';
  const player=matchPlayer(detail);
  const level=Number.isInteger(player?.championLevel)&&player.championLevel>0?player.championLevel:null;
  const ratio=match.deaths===0?(match.kills+match.assists>0?t('Hoàn hảo'):'—'):fixed(metrics.kda);
  const seconds=Number.isFinite(detail?.durationSeconds)&&detail.durationSeconds>0?detail.durationSeconds:match.durationMinutes*60;
  const damagePerMinute=Number.isFinite(match.damageToChampions)&&seconds>0?match.damageToChampions*60/seconds:null;
  const farming=mayhem?`<span class="card-damage">${t('Sát thương')} ${number(match.damageToChampions)} <span>(${fixed(damagePerMinute)}/m)</span></span>`:`<span class="card-cs">${number(match.cs)} CS <span>(${fixed(metrics.csPerMin)}/m)</span></span>`;
  return `<span class="card-outcome"><strong>${mayhem&&match.isRemake===true?t('ĐẤU LẠI'):match.result==='Victory'?t('THẮNG'):t('THUA')}</strong><span class="card-queue">${escape(t(match.queue==='Standard'?'Summoner’s Rift':match.queue))}</span><time class="card-date">${escape(dateLabel||t('Chưa rõ ngày'))}</time><span class="card-duration">${formatDuration(match.durationMinutes,detail?.durationSeconds)}</span></span>
    <span class="card-build"><span class="card-champion-line"><span class="card-portrait">${championAvatar(match.champion)}${level?`<span class="champion-level" title="${escape(t('Cấp {level}',{level}))}">${level}</span>`:''}</span><span class="card-champion-label"><strong>${escape(match.champion)}</strong><span>${escape(t(match.role||'Không áp dụng'))}</span></span>${renderSpells(player)}${mayhem&&!hasRuneData(player)?'':compactRunes(player)}</span>${renderItemSlots(player)}</span>
    <span class="card-performance"><strong class="card-kda">${number(match.kills)} <em>/ ${number(match.deaths)} /</em> ${number(match.assists)}</strong><span class="card-ratio">${ratio} KDA</span>${farming}<span class="card-kp">KP ${Number.isFinite(metrics.participation)?Math.round(metrics.participation*100)+'%':'—'} ${mayhem?'':`<span>· Vision ${number(match.visionScore)}</span>`}</span></span>
    <span class="card-lobby" aria-live="polite">${renderLobbyRank(match,rankState,source)}</span>${roster(detail)}<span class="card-expand"><span class="sr-only">${t('Mở chi tiết trận')}</span><span class="chevron" aria-hidden="true">⌄</span></span>`;
}
