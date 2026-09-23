import {t, getLocale, onLanguageChange, initLanguageUI} from './i18n.js';
import {renderMatchSummary, renderLoadout, renderItemSlots, renderSpells, renderLobbyRank, matchPlayer} from './match-view.js';
import {sampleMatchDetail} from './sample-loadouts.js';
import {championAvatar as avatar} from './champion-icons.js';
import {riotDataSource, loadLobbyRank, localizeLiveError} from './riot-source.js';
import {InputError} from './data.js';
import {sampleHistory, historyJsonSource, historyManualSource, exportHistory, MAX_MATCHES} from './history-data.js';
import {analyzeHistory, historyReportToMarkdown} from './history-coach.js';

const $=selector=>document.querySelector(selector);
const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const fmt=(value,digits=1)=>value===null||value===undefined?'—':new Intl.NumberFormat(getLocale(),{minimumFractionDigits:digits,maximumFractionDigits:digits}).format(Number(value));
const pct=value=>value===null||value===undefined?'—':Math.round(value*100)+'%';
const num=value=>value===null||value===undefined?'—':new Intl.NumberFormat(getLocale()).format(value);
const kda=stats=>stats.perfect?t("Không chết"):fmt(stats.kda,2);
const queueName=value=>value==='Standard'?t("SR · chưa rõ chế độ"):value;
const titleFor=()=>({survival:t("Số lần chết cần xem lại"),farm:t("Nhịp farm dưới mục tiêu"),vision:t("Vision dưới mục tiêu"),involvement:t("KP dưới ngưỡng xem lại")});
let history=sampleHistory(),source='sample',report=null,view='history',page=1,evidence=null,backup=null,busy=false,toastTimer,lookupBusy=false,liveDetails={},liveMeta=null;
let rankStates={},rankRequestBusy=false;
let lookupState={kind:'idle'},dialogMode='import',inputError=null,toastMessage=null;
const perPage=10;
const sourceLabels=()=>({sample:t("Dữ liệu mẫu giả lập"),json:t("JSON do bạn nhập · chưa xác minh"),manual:t("Dữ liệu bạn nhập · chưa xác minh"),riot:t("Dữ liệu từ Riot API")});
function filters(){return Object.fromEntries(new FormData($('#filters')).entries());}
function notify(message){toastMessage=typeof message==='function'?message:()=>message;const el=$('#toast');el.textContent=toastMessage();el.hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.hidden=true,4500);}
function download(text,filename,type){const url=URL.createObjectURL(new Blob([text],{type}));const a=document.createElement('a');a.href=url;a.download=filename;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1500);}
function hideErrors(){inputError=null;const el=$('#input-errors');el.hidden=true;el.replaceChildren();}
function showError(error,focus=true){inputError=error;const el=$('#input-errors');el.hidden=false;const ul=document.createElement('ul');for(const message of error instanceof InputError?error.messages:[t("Không thể đọc dữ liệu. Kiểm tra định dạng rồi thử lại.")]){const li=document.createElement('li');li.textContent=message;ul.append(li);}el.replaceChildren(ul);if(focus)el.focus();}
function initials(name){return name.slice(0,2).toUpperCase();}
function resetFilters(){ $('#filters').reset();page=1;evidence=null; }
function refreshChampionOptions(){const current=$('#champion-filter').value;const names=[...new Set(history.matches.map(m=>m.champion))].sort((a,b)=>a.localeCompare(b));$('#champion-filter').innerHTML=`<option value="">${t("Tất cả tướng")}</option>`+names.map(name=>`<option value="${escape(name)}">${escape(name)}</option>`).join('');if(names.includes(current))$('#champion-filter').value=current;}
function activate(next,nextSource,extra={}){rankStates={};backup={history,source,liveDetails,liveMeta};history=next;source=nextSource;liveDetails=extra.details||{};liveMeta=extra.meta||null;resetFilters();refreshChampionOptions();render();}
function metric(label,value,caption,extra=''){return `<div class="stat-card ${extra}"><span class="metric-label">${label}</span><strong class="metric-value">${value}</strong><span class="metric-caption">${caption}</span></div>`;}
function profile(){const p=history.profile;$('#profile-identity').innerHTML=`<div class="identity-avatar" aria-hidden="true">${escape(initials(p.riotId))}</div><div><div class="profile-kicker">${t("HỒ SƠ NGƯỜI CHƠI ")}<span class="source-pill">${source==='sample'?t("MẪU GIẢ LẬP"):source==='riot'?'RIOT API':t("DỮ LIỆU NHẬP")}</span></div><h1>${escape(p.riotId)}</h1><p class="profile-meta">${escape(p.region||t("Khu vực chưa nhập"))} <span>·</span>${t(" {value5} trận trong lịch sử ", {value5:history.matches.length})}<span>·</span> ${p.rank?escape(p.rank)+t(" (tự nhập)"):t("Rank chưa cung cấp")}</p></div>`;
const sourceTitle=source==='sample'?t("Bạn đang xem lịch sử mẫu."):source==='riot'?t("Đã tải dữ liệu từ Riot."):t("Đang phân tích lịch sử bạn cung cấp.");
const sourceMessage=source==='sample'?t("Các trận được giả lập. Tra cứu Riot ID ở trên để xem lịch sử thật."):source==='riot'?t("{value1}/{value2} trận được đưa vào đánh giá. {value3}Thời điểm tải: {value4}. Dữ liệu đã lấy có thể được dùng lại trong thời gian ngắn.", {value1:liveMeta?.included||history.matches.length, value2:liveMeta?.returned||history.matches.length, value3:liveMeta?.warnings?.length?liveMeta.warnings.length+t(" trận ngoài phạm vi hoặc thiếu chi tiết được bỏ qua. "):'', value4:dateText(liveMeta?.loadedAt)}):t("Dữ liệu nhập chưa được xác minh. Tải JSON để giữ lại trước khi tải lại trang.");
$('#source-banner').innerHTML=`<div><strong>${sourceTitle}</strong> ${escape(sourceMessage)}</div><div class="sample-controls"><label class="sr-only" for="sample-choice">${t("Chọn bộ dữ liệu mẫu")}</label><select id="sample-choice"><option value="mid">${t("Mẫu Mid / ADC")}</option><option value="support">${t("Mẫu Support")}</option></select><button type="button" class="text-btn" id="load-sample">${t("Xem mẫu")}</button>${backup?`<button type="button" class="text-btn" id="undo-data">${t("Hoàn tác thay dữ liệu")}</button>`:''}</div>`;}
function renderSummary(){const s=report.stats;const circumference=188.496;$('#summary').innerHTML=`<div class="stat-card winrate-card"><svg viewBox="0 0 76 76" class="win-donut" aria-hidden="true"><circle cx="38" cy="38" r="30" class="donut-track"/><circle cx="38" cy="38" r="30" class="donut-fill" stroke-dasharray="${(s.winRate||0)*circumference} ${circumference}" transform="rotate(-90 38 38)"/></svg><div><span class="metric-label">${t("TỈ LỆ THẮNG")}</span><strong class="metric-value">${pct(s.winRate)}</strong><span class="metric-caption"><span class="win-text">${t("{value4} thắng", {value4:s.wins})}</span> · <span class="loss-text">${t("{count} thua",{count:s.losses})}</span></span></div></div>${metric(t("KDA TỔNG HỢP"),kda(s),t("{value1} / {value2} / {value3} trung bình", {value1:fmt(s.avgKills), value2:fmt(s.avgDeaths), value3:fmt(s.avgAssists)}))}${metric(t("CS / PHÚT"),fmt(s.cs.value),t("{value1}/{value2} trận có CS", {value1:s.cs.known, value2:s.n}))}${metric(t("THAM GIA HẠ GỤC"),pct(s.participation),t("{value1}/{value2} trận tính được KP", {value1:s.participationKnown, value2:s.n}))}${metric(t("CHẾT / 30 PHÚT"),fmt(s.deathsPer30),t("Chuẩn hóa theo thời lượng"))}${metric(t("VISION / PHÚT"),fmt(s.vision.value),t("{value1}/{value2} trận có vision", {value1:s.vision.known, value2:s.n}))}`;}
function renderSidebar(){const r=report;$('#champion-stats').innerHTML=r.champions.length?r.champions.map(c=>`<button class="champion-item" type="button" data-champion="${escape(c.name)}" aria-label="${t("Lọc các trận {value2}", {value2:escape(c.name)})}">${avatar(c.name,true)}<span class="champion-name"><strong>${escape(c.name)}</strong><span>${t("{value5} trận · {value6} KDA", {value5:c.stats.n, value6:kda(c.stats)})}</span></span><span class="champion-result"><strong class="${c.stats.winRate>=.5?'win-text':'loss-text'}">${pct(c.stats.winRate)}</strong><span>${c.stats.wins}${t("T")} ${c.stats.losses}${t("B")}</span></span></button>`).join(''):`<p class="empty-small">${t("Không có trận khớp bộ lọc.")}</p>`;
$('#role-stats').innerHTML=r.roles.map(role=>`<button class="role-item" type="button" data-role="${escape(role.name)}"><span>${escape(role.name)}</span><meter min="0" max="${r.stats.n}" value="${role.stats.n}" aria-label="${t("{value5}: {value6} trận", {value5:escape(role.name), value6:role.stats.n})}"></meter><span>${t("{value7} trận", {value7:role.stats.n})}</span></button>`).join('')||`<p class="empty-small">${t("Chưa có dữ liệu vị trí.")}</p>`;
$('#data-coverage').innerHTML=r.coverage.map(item=>`<div class="coverage-row"><span>${item.label}</span><span>${t("{value2}/{value3} trận", {value2:item.known, value3:item.total})}</span></div>`).join('');}
function empty(title,body){return `<div class="empty-state panel"><h3>${title}</h3><p>${body}</p><button type="button" class="secondary-btn" data-reset>${t("Đặt lại bộ lọc")}</button></div>`;}
function renderFocus(){const r=report,p=r.priorities[0];$('#focus-preview').innerHTML=!r.stats.n?'':`<div class="focus-preview"><div><span class="eyebrow">${p?.repeated?t("VẤN ĐỀ LẶP LẠI"):t("ƯU TIÊN XEM LẠI")}</span><h2>${p?escape(p.title):t("Giữ thói quen tốt, xem kỹ quyết định")}</h2><p>${p?`${t("Có tín hiệu ở ")}<strong>${t("{value1}/{value2} trận", {value1:p.count, value2:p.denominator})}</strong>${t(" có dữ liệu. ")}${p.repeated?t("Bắt đầu từ vấn đề này trong 5 trận tiếp theo."):t("Chưa đủ để kết luận là thói quen lặp lại.")}`:t("Chưa có chỉ số vượt ngưỡng xem lại. Dùng replay để tìm điều cần luyện cụ thể hơn.")}</p></div><button class="focus-button" type="button" data-view="coaching">${t("Xem kế hoạch ")}<span aria-hidden="true">↗</span></button></div>`;}
function renderTrend(){const trend=report.trend;if(!report.stats.n){$('#trend').hidden=true;return;}$('#trend').hidden=false;
if(!trend.available){$('#trend').innerHTML=`<div class="panel-heading"><h2>${t("Xu hướng qua các trận")}</h2><span class="muted">${t("Chưa đủ dữ liệu")}</span></div><p class="small muted">${t("{value1} Hiện có {value2} trận {value3} trong bộ lọc.", {value1:escape(trend.reason), value2:trend.n, value3:escape(trend.role||t("cùng vị trí"))})}</p>`;return;}
$('#trend').innerHTML=`<div class="panel-heading"><h2>${t("Xu hướng {value1}", {value1:escape(trend.role)})}</h2><span class="muted">${t("{value2} trận trước → {value3} gần nhất", {value2:trend.size, value3:trend.size})}</span></div><div class="trend-grid">${trend.metrics.map(m=>{const delta=m.available?m.after-m.before:null;const better=m.id==='deaths'?delta<0:delta>0;return `<div class="trend-metric"><span>${m.label}</span>${m.available?`<p><span>${fmt(m.id==='kp'?m.before*100:m.before)}</span><span class="trend-arrow">→</span><strong>${fmt(m.id==='kp'?m.after*100:m.after)}${m.id==='kp'?'%':''}</strong></p><span class="trend-change ${Math.abs(delta)<.005?'':better?'win-text':'loss-text'}">${Math.abs(delta)<.005?t("Gần như không đổi"):`${delta>0?t("Tăng"):t("Giảm")} ${fmt(Math.abs(delta)*(m.id==='kp'?100:1))}${m.id==='kp'?t(" điểm %"):''}`}</span>`:`<p>—</p><span class="small muted">${t("Cần ≥ 5 trận có dữ liệu mỗi nhóm")}</span>`}</div>`;}).join('')}</div><p class="small muted trend-note">${t("So cùng vị trí để giảm khác biệt vai trò. Chỉ số thay đổi chưa chứng minh chất lượng quyết định tăng hay giảm.")}</p>`;}
function dateText(value){if(!value)return t("Chưa có ngày giờ");return new Intl.DateTimeFormat(getLocale(),{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(value));}
function matchDetail(match){
  return source==='sample'?sampleMatchDetail(match):liveDetails[match.id]||null;
}
function updateRankCard(id){
  const row=[...document.querySelectorAll('.match-row')].find(el=>el.dataset.matchId===id);
  const match=history.matches.find(m=>m.id===id);
  if(row&&match)row.querySelector('.card-lobby').innerHTML=renderLobbyRank(match,rankStates[id],source);
}
async function fetchMatchRank(id){
  if(source!=='riot'||rankStates[id]?.loading)return;
  if(rankRequestBusy){notify(()=>t("Đang tải rank một trận khác. Vui lòng đợi."));return;}
  const context=history;
  rankRequestBusy=true;rankStates={...rankStates,[id]:{loading:true}};updateRankCard(id);
  try{
    const lobbyRank=await loadLobbyRank({matchId:id,region:history.profile.region.toLowerCase()});
    if(history===context)rankStates={...rankStates,[id]:{lobbyRank}};
  }catch(error){
    if(history===context)rankStates={...rankStates,[id]:{rawError:error,error:requestErrorMessage(error,'Chưa tải được rank.')}};
  }finally{
    rankRequestBusy=false;
    if(history===context)updateRankCard(id);
  }
}

function participantRow(p){
  return `<tr class="${p.isPlayer?'player-row':''}"><td><div class="participant-name"><strong>${escape(p.riotId||t("Chưa có Riot ID"))}</strong>${p.isPlayer?`<span class="participant-you">${t("Bạn")}</span>`:''}</div></td><td><div class="participant-champion">${avatar(p.champion,true)}<span><strong>${escape(p.champion)}</strong><br><span class="small muted">${escape(p.role)}</span></span></div></td><td><div class="participant-loadout">${renderSpells(p)}${renderItemSlots(p)}</div></td><td>${num(p.kills)} / ${num(p.deaths)} / ${num(p.assists)}</td><td>${num(p.cs)}</td><td>${num(p.damageToChampions)}</td><td>${num(p.goldEarned)}</td><td>${num(p.visionScore)}</td></tr>`;
}
function participantTeam(team){
  if(!team.players.length)return '';
  const ownTeam=team.players.some(p=>p.isPlayer);
  return `<section class="participant-team team-${team.color}" aria-label="${team.label}">
    <header class="participant-team-header">
      <div class="participant-team-title"><span class="team-marker" aria-hidden="true"></span><div><h4>${team.label}</h4><p>${t("{value4} người chơi", {value4:team.players.length})}</p></div></div>
      ${ownTeam?`<span class="your-team-badge">${t("Đội của bạn")}</span>`:''}
    </header>
    <div class="participant-scroll" tabindex="0" role="region" aria-label="${t("Bảng thống kê {value6}", {value6:team.label.toLowerCase()})}">
      <table><caption class="sr-only">${t("Thống kê {value7}", {value7:team.label.toLowerCase()})}</caption><thead><tr><th scope="col">${t("Người chơi")}</th><th scope="col">${t("Tướng")}</th><th scope="col">${t("Bộ trang bị")}</th><th scope="col">K / D / A</th><th scope="col">CS</th><th scope="col">${t("Sát thương")}</th><th scope="col">${t("Vàng")}</th><th scope="col">Vision</th></tr></thead><tbody>${team.players.map(participantRow).join('')}</tbody></table>
    </div>
  </section>`;
}
function participantTable(id){
  const match=history.matches.find(m=>m.id===id);
  const detail=match?matchDetail(match):null;
  if(!Array.isArray(detail?.participants)||!detail.participants.length)return '';
  const teams=[
    {color:'blue',label:t("Đội xanh"),players:detail.participants.filter(p=>p.teamId===100)},
    {color:'red',label:t("Đội đỏ"),players:detail.participants.filter(p=>p.teamId===200)},
    {color:'unknown',label:t("Chưa xác định đội"),players:detail.participants.filter(p=>p.teamId!==100&&p.teamId!==200)}
  ];
  return `<section class="participants"><div class="participants-heading"><h3>${t("Thống kê hai đội")}</h3><p class="small muted">${escape(detail.sample?t("Mẫu giả lập · "):detail.gameVersion?t("Phiên bản ")+detail.gameVersion+' · ':'')}${detail.sample?t("Không phải dữ liệu người chơi thật"):t("Số liệu từ Riot API")}</p></div><p class="team-scroll-hint small muted">${t("Vuốt ngang từng bảng để xem đầy đủ chỉ số →")}</p><div class="participant-teams">${teams.map(participantTeam).join('')}</div></section>`;
}
function row(entry,index){const m=entry.match,x=entry.metrics,win=m.result==='Victory',detail=matchDetail(m);const tags=entry.mistakes.map(p=>`<span class="review-tag">${escape(titleFor()[p.id])}</span>`).join('');return `<details class="match-row match-card ${win?'victory':'defeat'}" id="match-row-${index}" data-match-id="${escape(m.id)}"><summary>${renderMatchSummary({match:m,metrics:x,detail,rankState:source==='sample'?{lobbyRank:detail.lobbyRank}:rankStates[m.id],source,dateLabel:dateText(m.playedAt)})}</summary><div class="match-detail">${renderLoadout(matchPlayer(detail))}<div class="detail-metrics"><div><span>${t("Sát thương lên tướng")}</span><strong>${num(m.damageToChampions)}</strong><span>${t("{value7} / phút", {value7:fmt(m.damageToChampions===null?null:m.damageToChampions/m.durationMinutes)})}</span></div><div><span>${t("Vàng kiếm được")}</span><strong>${num(m.goldEarned)}</strong><span>${t("{value9} / phút", {value9:fmt(m.goldEarned===null?null:m.goldEarned/m.durationMinutes)})}</span></div><div><span>${t("Chết / 30 phút")}</span><strong>${fmt(x.deathsPer30)}</strong><span>${t("{value11} lần chết trong trận", {value11:m.deaths})}</span></div><div><span>${t("Vision / phút")}</span><strong>${fmt(x.visionPerMin)}</strong><span>${m.role==='Support'?t("Ngưỡng riêng cho Support"):t("Vai trò ")+escape(m.role)}</span></div></div><div class="match-review"><strong>${t("Tín hiệu của trận này")}</strong><div class="review-tags">${tags||`<span class="small muted">${t("Chưa có chỉ số vượt ngưỡng xem lại.")}</span>`}</div><p class="small muted">${t("Các nhãn là dấu hiệu để xem lại replay. Ưu tiên coaching được xác định trên toàn bộ {value15} trận trong bộ lọc.", {value15:report.stats.n})}</p>${m.notes?`<p class="match-notes"><strong>${t("Ghi chú của bạn · không tự phân tích")}</strong><br>${escape(m.notes)}</p>`:''}${participantTable(m.id)}<span class="match-id">${escape(m.id)}</span></div></div></details>`;}
function renderHistory(){let entries=report.entries;const finding=report.findings.find(x=>x.id===evidence);if(finding)entries=entries.filter(e=>finding.matchIds.includes(e.match.id));else evidence=null;
$('#evidence-filter').hidden=!finding;if(finding)$('#evidence-filter').innerHTML=`<div class="evidence-banner"><span>${t("Đang xem {value1} trận có tín hiệu: ", {value1:finding.count})}<strong>${escape(finding.title)}</strong>${t(". Báo cáo vẫn dùng toàn bộ {value3} trận đã chọn.", {value3:report.stats.n})}</span><button class="text-btn" type="button" id="clear-evidence">${t("Xem lại toàn bộ")}</button></div>`;
$('#result-strip').innerHTML=report.matches.slice(0,20).map(m=>`<span class="result-square ${m.result==='Victory'?'win':'loss'}" title="${escape(m.champion)} · ${m.result==='Victory'?t("Thắng"):t("Thua")}">${m.result==='Victory'?t("T"):t("B")}</span>`).join('');
const pages=Math.max(1,Math.ceil(entries.length/perPage));page=Math.min(page,pages);const start=(page-1)*perPage;
$('#match-list').innerHTML=entries.length?entries.slice(start,start+perPage).map((e,i)=>row(e,start+i)).join(''):empty(t("Không có trận để phân tích"),t("Thử bỏ bộ lọc hoặc nhập thêm lịch sử Summoner’s Rift. Remake và chế độ ngoài phạm vi không được đánh giá."));
$('#pagination').innerHTML=entries.length?`<span>${t("{value1}–{value2} / {value3} trận · mới nhất trước", {value1:start+1, value2:Math.min(start+perPage,entries.length), value3:entries.length})}</span><div><button class="secondary-btn" type="button" id="prev-page" ${page===1?'disabled':''}>${t("Trước")}</button><span>${page} / ${pages}</span><button class="secondary-btn" type="button" id="next-page" ${page===pages?'disabled':''}>${t("Tiếp")}</button></div>`:'';}
function evidenceButton(f){return `<button class="text-btn" type="button" data-evidence="${f.id}">${t("Xem {value2} trận làm dẫn chứng ↗", {value2:f.count})}</button>`;}
function renderCoaching(){const r=report;if(!r.stats.n){$('#coaching-report').innerHTML=empty(t("Chưa có dữ liệu cho báo cáo"),t("Chọn bộ lọc có trận phù hợp, hoặc nhập lịch sử của bạn."));return;}
$('#coaching-report').innerHTML=`<section class="coaching-intro panel"><div><span class="eyebrow">${t("ĐÁNH GIÁ TỪ LỊCH SỬ TRẬN")}</span><h2>${t("{value1} trận. Những điều đáng tập trung.", {value1:r.stats.n})}</h2><p>${r.stats.n<5?t("Mẫu còn nhỏ: kết quả mới là tín hiệu ban đầu, chưa đủ xác định một thói quen."):t("Có {value1} vấn đề đạt ngưỡng lặp lại và {value2} tín hiệu tích cực xuất hiện đều.", {value1:r.findings.filter(x=>x.repeated).length, value2:r.strengths.length})}</p></div><div class="report-actions"><button class="secondary-btn" type="button" id="copy-report">${t("Sao chép")}</button><button class="secondary-btn" type="button" id="download-report">${t("Tải báo cáo ↓")}</button></div></section>
<section class="coaching-section"><div class="section-heading"><h2>${t("Điểm mạnh nên giữ")}</h2><span>${t("{value3} tín hiệu", {value3:r.strengths.length})}</span></div><div class="strength-grid">${r.strengths.length?r.strengths.map(s=>`<article class="strength-card"><span class="signal-count">${t("{value1}/{value2} trận", {value1:s.count, value2:s.denominator})}</span><h3>${escape(s.title)}</h3><p>${escape(s.caveat)}</p></article>`).join(''):`<div class="panel empty-small">${t("Chưa có điểm mạnh lặp lại đủ rõ từ các chỉ số được cung cấp. Điều này không có nghĩa là bạn chơi kém.")}</div>`}</div></section>
<section class="coaching-section"><div class="section-heading"><h2>${t("Vấn đề cần xem lại")}</h2><span>${t("{value5} tín hiệu", {value5:r.findings.length})}</span></div>${r.findings.length?r.findings.map(f=>`<article class="finding-card"><div class="finding-heading"><h3>${escape(f.title)}</h3><span class="finding-badge ${f.repeated?'repeated':''}">${f.repeated?t("Lặp lại"):t("Theo dõi thêm")}</span></div><div class="finding-frequency"><strong>${f.count}<span>${t("/{value5} trận có dữ liệu", {value5:f.denominator})}</span></strong><meter min="0" max="${f.denominator}" value="${f.count}" aria-label="${t("Xuất hiện ở {value8} trên {value9} trận", {value8:f.count, value9:f.denominator})}"></meter></div><p>${escape(f.caveat)}</p>${evidenceButton(f)}</article>`).join(''):`<div class="panel empty-small">${t("Chưa có chỉ số vượt ngưỡng xem lại. Dùng replay để tìm các quyết định cần cải thiện.")}</div>`}</section>
<section class="practice-plan"><span class="eyebrow">${t("LUYỆN TẬP CÓ TRỌNG TÂM")}</span><h2>${t("Kế hoạch cho 5 trận tiếp theo")}</h2>${r.priorities.length?r.priorities.map((p,i)=>`<article class="practice-step"><span class="step-number">0${i+1}</span><div><h3>${escape(p.title)}</h3><p>${escape(p.action)}</p><div class="practice-target"><strong>${t("Cách theo dõi")}</strong><p>${escape(p.target)}</p></div></div></article>`).join(''):`<p>${t("Xem lại một giao tranh và một lần di chuyển mỗi trận. Ghi một quyết định để lặp lại và một quyết định cần xem thêm.")}</p>`}<p class="practice-foot">${t("Sau 5 trận, nhập lịch sử cập nhật và so xu hướng của cùng vị trí.")}</p></section>
<details class="report-limits"><summary>${t("Phạm vi và giới hạn của báo cáo")}</summary><ul>${r.limitations.map(x=>`<li>${escape(x)}</li>`).join('')}</ul></details>`;}
function render(){
const analyzed=analyzeHistory(history,filters());
const importedLimit=t('Các trận tải lên thuộc một người chơi do bạn xác nhận; danh tính, rank và dữ liệu nhập chưa được Riot xác minh.');
report={...analyzed,sourceLabel:sourceLabels()[source],limitations:source==='riot'?[...analyzed.limitations.filter(x=>x!==importedLimit),t('Dữ liệu được lấy từ Riot API và có thể được dùng lại từ bộ nhớ tạm. Rank lobby là rank hiện tại, được tải riêng và không dùng để chấm coaching.')]:analyzed.limitations};profile();renderSummary();renderSidebar();renderFocus();renderTrend();renderHistory();renderCoaching();$('#scope').textContent=t("Đánh giá {value1}/{value2} trận khớp bộ lọc · {value3} trận ngoài phạm vi được loại · {value4}. Tất cả chỉ số và coaching cùng dùng phạm vi này.", {value1:report.stats.n, value2:report.available, value3:report.excluded, value4:history.ordering==='date'?t("xếp theo ngày giờ"):t("giữ thứ tự nhập, mới nhất trước")});}
function switchView(next,focus=false){view=next;for(const name of ['history','coaching']){const selected=name===next;$(`#${name}-tab`).setAttribute('aria-selected',String(selected));$(`#${name}-tab`).tabIndex=selected?0:-1;$(`#${name}-panel`).hidden=!selected;}if(focus)$(`#${next}-tab`).focus();}
function openDialog(mode){dialogMode=mode;hideErrors();$('#import-panel').hidden=mode!=='import';$('#manual-form').hidden=mode!=='manual';$('#dialog-title').textContent=mode==='import'?t("Nhập lịch sử trận"):t("Thêm trận vào lịch sử");if(mode==='manual'){const form=$('#manual-form');form.reset();form.elements.riotId.value=source==='sample'?'':history.profile.riotId;form.elements.region.value=source==='sample'?'':history.profile.region;$('#manual-note').textContent=source==='sample'?t("Trận đầu tiên của bạn sẽ thay lịch sử mẫu; không trộn dữ liệu thật với trận giả lập."):t("Trận này cần thuộc cùng người chơi với lịch sử đang xem. Nếu không có ngày giờ, trận mới được đặt đầu danh sách.");}$('#input-dialog').showModal();}
async function applyJson(){if(busy)return;busy=true;$('#apply-json').disabled=true;hideErrors();try{activate(await historyJsonSource.load($('#json-input').value),'json');$('#input-dialog').close();notify(()=>t("Đã phân tích lịch sử {value1} trận.", {value1:history.matches.length}));}catch(error){showError(error);}finally{busy=false;$('#apply-json').disabled=false;}}
$('#filters').addEventListener('submit',e=>e.preventDefault());$('#filters').addEventListener('change',()=>{page=1;evidence=null;render();});
$('#reset-filters').addEventListener('click',()=>{resetFilters();render();});
$('#add-match').addEventListener('click',()=>openDialog('manual'));$('#import-history').addEventListener('click',()=>openDialog('import'));
$('#close-dialog').addEventListener('click',()=>$('#input-dialog').close());$('#apply-json').addEventListener('click',applyJson);
$('#use-template').addEventListener('click',()=>{const sample=exportHistory(sampleHistory());sample.matches=sample.matches.slice(0,3);$('#json-input').value=JSON.stringify(sample,null,2);hideErrors();notify(()=>t("Đã điền 3 trận mẫu giả lập. Thay bằng dữ liệu của bạn."));});
$('#use-current').addEventListener('click',()=>{$('#json-input').value=JSON.stringify(exportHistory(history),null,2);hideErrors();});
$('#json-file').addEventListener('change',async e=>{const file=e.target.files[0];if(!file)return;hideErrors();try{if(file.size>2000000)throw new InputError([()=>t("File cần nhỏ hơn 2 MB.")]);$('#json-input').value=await file.text();notify(()=>t("Đã đọc file. Bấm Phân tích lịch sử để áp dụng."));}catch(error){showError(error);}e.target.value='';});
$('#export-json').addEventListener('click',()=>download(JSON.stringify(exportHistory(history),null,2),'rift-review-history.json','application/json'));
$('#manual-form').addEventListener('submit',async e=>{e.preventDefault();if(busy)return;busy=true;const submit=e.submitter||e.target.querySelector('button[type=submit]');submit.disabled=true;hideErrors();try{const data=Object.fromEntries(new FormData(e.target));const previous=source==='sample'?[]:history.matches;if(previous.length>=MAX_MATCHES)throw new InputError([()=>t("Tối đa 500 trận. Chỉnh JSON để giữ các trận cần phân tích.")]);const date=data.playedAt?new Date(data.playedAt):null;if(date&&!Number.isFinite(date.getTime()))throw new InputError([()=>t("Ngày giờ không hợp lệ.")]);const entry={...data,id:`manual-${crypto.randomUUID()}`,playedAt:date?date.toISOString():null,isRemake:e.target.elements.isRemake.checked};const next=await historyManualSource.load({profile:{riotId:data.riotId,region:data.region,rank:source==='sample'?'':history.profile.rank},matches:[entry,...previous]});activate(next,'manual');$('#input-dialog').close();notify(()=>t("Đã thêm trận và cập nhật toàn bộ đánh giá."));}catch(error){showError(error);}finally{busy=false;submit.disabled=false;}});
$('.tab-list').addEventListener('keydown',e=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();switchView(e.key==='Home'?'history':e.key==='End'?'coaching':view==='history'?'coaching':'history',true);}});
$('#history-tab').addEventListener('click',()=>switchView('history'));$('#coaching-tab').addEventListener('click',()=>switchView('coaching'));
document.addEventListener('click',async e=>{const button=e.target.closest('button,a');if(!button)return;
if(button.hasAttribute('data-load-rank')){e.preventDefault();await fetchMatchRank(button.dataset.loadRank);return;}
if(button.dataset.view){switchView(button.dataset.view);if(button.tagName==='BUTTON')$('#workspace').scrollIntoView({behavior:'smooth',block:'start'});}
if(button.hasAttribute('data-reset')){resetFilters();render();}
if(button.dataset.champion){$('#champion-filter').value=button.dataset.champion;page=1;evidence=null;render();}
if(button.dataset.role){$('#role-filter').value=button.dataset.role;page=1;evidence=null;render();}
if(button.dataset.evidence){evidence=button.dataset.evidence;page=1;switchView('history');renderHistory();$('#evidence-filter').scrollIntoView({behavior:'smooth',block:'center'});}
if(button.id==='clear-evidence'){evidence=null;page=1;renderHistory();}
if(button.id==='prev-page'||button.id==='next-page'){page+=button.id==='next-page'?1:-1;renderHistory();$('.history-heading').scrollIntoView({behavior:'smooth',block:'start'});}
if(button.id==='load-sample'){activate(sampleHistory($('#sample-choice').value),'sample');notify(()=>t("Đang xem dữ liệu mẫu giả lập."));}
if(button.id==='undo-data'&&backup){rankStates={};const previous={history,source,liveDetails,liveMeta};history=backup.history;source=backup.source;liveDetails=backup.liveDetails||{};liveMeta=backup.liveMeta||null;backup=previous;resetFilters();refreshChampionOptions();render();notify(()=>t("Đã khôi phục bộ dữ liệu trước đó."));}
if(button.id==='download-report')download(historyReportToMarkdown(report),'rift-review-coaching.md','text/markdown');
if(button.id==='copy-report'){try{await navigator.clipboard.writeText(historyReportToMarkdown(report));notify(()=>t("Đã sao chép báo cáo."));}catch{notify(()=>t("Không sao chép được. Bạn có thể tải báo cáo thay thế."));}}
});
document.addEventListener('error',event=>{
  const image=event.target;
  if(image instanceof HTMLImageElement&&(image.hasAttribute('data-champion-icon')||image.hasAttribute('data-game-icon')))image.remove();
},true);
function requestErrorMessage(error,fallback){
  const message=error?.rawMessage!==undefined?localizeLiveError(error.rawMessage,error.code):error instanceof InputError?error.messages.join(' '):t(fallback);
  return message+(error?.retryAfter?t(' Thử lại sau {value1} giây.',{value1:error.retryAfter}):'');
}
function renderLookupStatus(){
  const button=$('#lookup-button'),status=$('#lookup-status');
  button.disabled=lookupBusy;
  button.textContent=t(lookupBusy?'Đang tải…':'Tra cứu lịch sử');
  status.classList.toggle('lookup-error',lookupState.kind==='error');
  if(lookupState.kind==='loading')status.textContent=t('Đang lấy tài khoản và lịch sử trận từ Riot. Giữ nguyên trang trong khi tải.');
  else if(lookupState.kind==='success')status.textContent=t('Đã tải {value1} trận phù hợp của {value2} ({value3}).',lookupState.values);
  else if(lookupState.kind==='error')status.textContent=requestErrorMessage(lookupState.error,'Chưa thể tải lịch sử.')+t(' Dữ liệu đang xem được giữ nguyên.');
  else if(lookupState.kind==='setup')status.textContent=t('Chức năng tra cứu đã sẵn sàng; cần cấu hình Riot API key trên máy chủ để kết nối.');
  else status.textContent=t('Tra cứu trận đã kết thúc. Bạn vẫn có thể nhập JSON hoặc thêm trận thủ công ở bên dưới.');
}
function renderDialogCopy(){
  $('#dialog-title').textContent=t(dialogMode==='import'?'Nhập lịch sử trận':'Thêm trận vào lịch sử');
  $('#manual-note').textContent=t(source==='sample'?'Trận đầu tiên của bạn sẽ thay lịch sử mẫu; không trộn dữ liệu thật với trận giả lập.':'Trận này cần thuộc cùng người chơi với lịch sử đang xem. Nếu không có ngày giờ, trận mới được đặt đầu danh sách.');
}
onLanguageChange(()=>{
  const openMatches=new Set([...document.querySelectorAll('.match-row[open]')].map(row=>row.dataset.matchId));
  const limitsOpen=$('.report-limits')?.open;
  const sampleChoice=$('#sample-choice')?.value;
  const scrollPosition={x:window.scrollX,y:window.scrollY};
  rankStates=Object.fromEntries(Object.entries(rankStates).map(([id,state])=>[id,state.rawError?{...state,error:requestErrorMessage(state.rawError,'Chưa tải được rank.')}:state]));
  refreshChampionOptions();render();
  for(const row of document.querySelectorAll('.match-row'))row.open=openMatches.has(row.dataset.matchId);
  if($('.report-limits'))$('.report-limits').open=Boolean(limitsOpen);
  if(sampleChoice)$('#sample-choice').value=sampleChoice;
  switchView(view);renderDialogCopy();renderLookupStatus();
  if(inputError)showError(inputError,false);
  if(toastMessage&&!$('#toast').hidden)$('#toast').textContent=toastMessage();
  window.scrollTo(scrollPosition.x,scrollPosition.y);
});
initLanguageUI();refreshChampionOptions();render();renderLookupStatus();

$('#riot-lookup').addEventListener('submit',async e=>{
  e.preventDefault();if(lookupBusy)return;
  const form=e.target;
  lookupBusy=true;lookupState={kind:'loading'};renderLookupStatus();
  try{
    const result=await riotDataSource.load(Object.fromEntries(new FormData(form)));
    activate(result.history,'riot',{details:result.details,meta:result.meta});
    const count=Number(form.elements.count.value);$('#limit-filter').value=String(count);render();
    switchView('history');lookupState={kind:'success',values:{value1:history.matches.length,value2:history.profile.riotId,value3:history.profile.region}};
    notify(()=>t('Lịch sử thật đã được đưa vào báo cáo coaching.'));
  }catch(error){lookupState={kind:'error',error};}
  finally{lookupBusy=false;renderLookupStatus();}
});
fetch('/api/status',{credentials:'same-origin'}).then(r=>r.ok?r.json():null).then(status=>{
  if(status&&!status.riotConfigured&&lookupState.kind==='idle'){lookupState={kind:'setup'};renderLookupStatus();}
}).catch(()=>{});
