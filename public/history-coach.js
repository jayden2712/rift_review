import {generateReport, RULES} from './coach.js';
import {exclusionReason} from './history-data.js';

const sum = (list, field) => list.reduce((total, item) => total + item[field], 0);
const ratio = (a,b) => b > 0 ? a/b : null;
export function aggregate(matches) {
  const n=matches.length, wins=matches.filter(m=>m.result==='Victory').length;
  const minutes=sum(matches,'durationMinutes');
  const kills=sum(matches,'kills'), deaths=sum(matches,'deaths'), assists=sum(matches,'assists');
  const rate = (field) => {const known=matches.filter(m=>m[field]!==null && m[field]!==undefined);return {value:ratio(sum(known,field),sum(known,'durationMinutes')),known:known.length};};
  const kpMatches=matches.filter(m=>m.teamKills>0);
  const participation=ratio(sum(kpMatches,'kills')+sum(kpMatches,'assists'),sum(kpMatches,'teamKills'));
  return {n,wins,losses:n-wins,winRate:ratio(wins,n),kills,deaths,assists,kda:ratio(kills+assists,deaths),perfect:deaths===0&&kills+assists>0,avgKills:ratio(kills,n),avgDeaths:ratio(deaths,n),avgAssists:ratio(assists,n),deathsPer30:ratio(deaths*30,minutes),cs:rate('cs'),vision:rate('visionScore'),damage:rate('damageToChampions'),gold:rate('goldEarned'),participation,participationKnown:kpMatches.length};
}

export function selectMatches(history, filters={}) {
  const eligible=history.matches.filter(m=>!exclusionReason(m));
  const matching=eligible.filter(m=>(!filters.role||m.role===filters.role)&&(!filters.champion||m.champion===filters.champion)&&(!filters.queue||m.queue===filters.queue));
  const limit=[10,20,50,100,500].includes(Number(filters.limit))?Number(filters.limit):20;
  return {matches:matching.slice(0,limit),available:matching.length,excluded:history.matches.length-eligible.length,eligible:eligible.length};
}

function groups(matches, field) {
  const map=new Map();
  for(const match of matches) {const key=match[field];if(!map.has(key))map.set(key,[]);map.get(key).push(match);}
  return [...map].map(([name,items])=>({name,matches:items,stats:aggregate(items)})).sort((a,b)=>b.stats.n-a.stats.n||b.stats.wins-a.stats.wins||a.name.localeCompare(b.name));
}

const COPY={
 survival:{title:'Giảm những lần chết có thể tránh',strength:'Số lần chết thấp xuất hiện đều',caveat:'Số lần chết không cho biết nguyên nhân hay giá trị của pha đổi mạng. Cần xem lại tình huống.',action:'Xem lại 3 lần chết gần nhất. Ghi điều bạn biết trước khi lao vào, đường rút và giá trị đội nhận được.',target:'Trong 5 trận tiếp theo, ghi 1 nguyên nhân chết mỗi trận và chọn một nguyên nhân lặp lại để sửa.',weight:100},
 farm:{title:'Giữ nhịp farm giữa các pha di chuyển',strength:'Nhịp farm tốt ở nhiều trận',caveat:'Mục tiêu CS thay đổi theo vị trí. Không chấm farm cho Support; chỉ số cả trận không chỉ ra lúc bạn bỏ lính.',action:'Với vị trí đi đường, xem lại wave trước khi biến về hoặc đảo đường. Với Jungle, xem thời gian di chuyển và chờ giữa các camp.',target:'Trong 5 trận cùng vị trí, thử tăng trung bình 0,5 CS/phút bằng các wave hoặc camp an toàn; không đổi mục tiêu quan trọng chỉ để tăng CS.',weight:80},
 vision:{title:'Cải thiện việc chuẩn bị tầm nhìn',strength:'Đóng góp tầm nhìn xuất hiện đều',caveat:'Vision score không đánh giá được chất lượng vị trí cắm mắt. Ngưỡng Support khác các vị trí còn lại.',action:'Xem lại tầm nhìn trước 2 mục tiêu lớn. Kiểm tra thời điểm dùng phụ kiện và có đồng đội đi cùng khi vào vùng tối.',target:'Ghi lại 2 lần chuẩn bị tầm nhìn trước mục tiêu trong mỗi trận tiếp theo.',weight:60},
 involvement:{title:'Xem lại cách tham gia các pha của đội',strength:'Tham gia nhiều mạng hạ gục của đội',caveat:'KP thấp có thể đi cùng đẩy lẻ hoặc đổi mục tiêu hợp lý; không đủ để kết luận phối hợp kém.',action:'Xem lại 2 giao tranh bạn vắng mặt. Ghi lý do không tham gia và lợi ích đạt được ở phần bản đồ còn lại.',target:'Trong 5 trận tiếp theo, ghi 1 quyết định tham gia giao tranh hoặc đổi mục tiêu mỗi trận.',weight:70},
};

function eligibleFor(id, entry) {
  if(id==='farm')return entry.match.role!=='Support'&&entry.metrics.csPerMin!==null;
  if(id==='vision')return entry.metrics.visionPerMin!==null;
  if(id==='involvement')return entry.metrics.participation!==null;
  return true;
}
function isStrength(id, {match:m,metrics:x}) {
  if(id==='survival')return x.deathsPer30<=RULES.deathsStrength;
  if(id==='farm')return x.csPerMin>=RULES.csStrength[m.role];
  if(id==='vision')return x.visionPerMin>=(m.role==='Support'?RULES.supportVisionStrength:RULES.visionStrength);
  return x.participation>=RULES.kpStrength;
}

export function buildTrend(matches, roleGroups) {
  const role=roleGroups[0]?.name;
  const cohort=matches.filter(m=>m.role===role);
  if(cohort.length<10) return {available:false,role,n:cohort.length,reason:'Cần ít nhất 10 trận cùng vị trí để so hai nhóm tối thiểu 5 trận.'};
  const size=Math.min(10,Math.floor(cohort.length/2));
  const recentMatches=cohort.slice(0,size),previousMatches=cohort.slice(size,size*2);
  const recent=aggregate(recentMatches),previous=aggregate(previousMatches);
  const metric=(id,label,before,after,knownBefore,knownAfter)=>({id,label,before,after,knownBefore,knownAfter,available:before!==null&&after!==null&&knownBefore>=5&&knownAfter>=5});
  const metrics=[
    metric('deaths','Chết / 30 phút',previous.deathsPer30,recent.deathsPer30,size,size),
    ...(role==='Support'?[]:[metric('cs','CS / phút',previous.cs.value,recent.cs.value,previous.cs.known,recent.cs.known)]),
    metric('vision','Vision / phút',previous.vision.value,recent.vision.value,previous.vision.known,recent.vision.known),
    metric('kp','KP',previous.participation,recent.participation,previous.participationKnown,recent.participationKnown),
  ];
  return {available:true,role,size,recent,previous,metrics,recentIds:recentMatches.map(m=>m.id),previousIds:previousMatches.map(m=>m.id)};
}

export function analyzeHistory(history, filters={}) {
  const selected=selectMatches(history,filters),matches=selected.matches;
  const stats=aggregate(matches),champions=groups(matches,'champion'),roles=groups(matches,'role');
  const entries=matches.map(match=>({match,...generateReport(match)}));
  const findings=[],strengths=[];
  for(const [id,copy] of Object.entries(COPY)) {
    const known=entries.filter(entry=>eligibleFor(id,entry));
    if(!known.length)continue;
    const flagged=known.filter(entry=>entry.mistakes.some(mistake=>mistake.id===id));
    const good=known.filter(entry=>isStrength(id,entry));
    if(flagged.length) {
      const repeated=known.length>=5&&flagged.length>=3&&flagged.length/known.length>=.3;
      findings.push({id,...copy,count:flagged.length,denominator:known.length,fraction:flagged.length/known.length,repeated,matchIds:flagged.map(x=>x.match.id)});
    }
    if(good.length>=3&&good.length/known.length>=.6) strengths.push({id,title:copy.strength,caveat:copy.caveat,count:good.length,denominator:known.length,matchIds:good.map(x=>x.match.id)});
  }
  findings.sort((a,b)=>Number(b.repeated)-Number(a.repeated)||(b.fraction*b.weight-a.fraction*a.weight)||b.count-a.count);
  const priorities=findings.slice(0,2);
  const trend=buildTrend(matches,roles);
  return {engine:'Quy tắc coaching v2',history,filters:{...filters},...selected,stats,champions,roles,entries,findings,strengths,priorities,trend,
    coverage:[{label:'CS',known:stats.cs.known,total:stats.n},{label:'Vision',known:stats.vision.known,total:stats.n},{label:'KP',known:stats.participationKnown,total:stats.n},{label:'Sát thương',known:stats.damage.known,total:stats.n}],
    limitations:['Các ngưỡng là mục tiêu luyện tập minh họa, không phải chuẩn rank, tướng hoặc phiên bản game.','Lịch sử chỉ cho thấy mối liên hệ giữa các chỉ số; không xác định nguyên nhân thắng/thua, cơ chế, vị trí đứng hoặc chất lượng quyết định.','Thống kê và báo cáo dùng đúng bộ lọc hiện tại. Dữ liệu thiếu không được đổi thành 0. Remake, trận dưới 5 phút và chế độ không hỗ trợ được loại khỏi đánh giá.',history.ordering==='date'?'Trận được sắp theo playedAt, mới nhất trước.':'Có trận thiếu ngày giờ: toàn bộ lịch sử giữ thứ tự nhập, mới nhất trước. Xu hướng phụ thuộc thứ tự này.','Các trận tải lên thuộc một người chơi do bạn xác nhận; danh tính, rank và dữ liệu nhập chưa được Riot xác minh.']};
}

const format=(n,d=1)=>n===null?'—':n.toFixed(d);
export function historyReportToMarkdown(r) {
  const s=r.stats;
  return [`# Rift Review — ${r.history.profile.riotId}`,`Nguồn: ${r.sourceLabel??'Dữ liệu nhập'} · ${r.engine}`,`Bộ lọc: ${r.filters.queue||'Tất cả chế độ SR'} / ${r.filters.role||'Tất cả vị trí'} / ${r.filters.champion||'Tất cả tướng'} / ${r.filters.limit||20} trận gần nhất.`,`${s.n} trận · ${s.wins} thắng / ${s.losses} thua · WR ${format(s.winRate===null?null:s.winRate*100)}%`,`KDA: ${s.perfect?'Không chết':format(s.kda,2)} · CS/phút: ${format(s.cs.value)} (${s.cs.known}/${s.n} trận) · KP: ${format(s.participation===null?null:s.participation*100)}% (${s.participationKnown}/${s.n} trận)`,
  '## Điểm mạnh',...(r.strengths.length?r.strengths.map(x=>`- ${x.title}: ${x.count}/${x.denominator} trận. ${x.caveat}`):['Chưa có điểm mạnh lặp lại đủ rõ từ các chỉ số được cung cấp.']),
  '## Vấn đề cần xem lại',...(r.findings.length?r.findings.map(x=>`- ${x.title}: ${x.count}/${x.denominator} trận có dữ liệu (${x.repeated?'lặp lại':'cần theo dõi thêm'}). ${x.caveat}\n  Trận: ${x.matchIds.join(', ')}`):['Chưa có chỉ số vượt ngưỡng xem lại. Không có nghĩa là không có sai sót.']),
  '## Ưu tiên cho 5 trận tiếp theo',...(r.priorities.length?r.priorities.map((x,i)=>`${i+1}. ${x.title}\n${x.action}\nMục tiêu: ${x.target}`):['Xem lại một giao tranh và một lần di chuyển mỗi trận; ghi một quyết định để lặp lại và một quyết định cần xem thêm.']),
  '## Xu hướng cùng vị trí',...(r.trend.available?[`${r.trend.role}: ${r.trend.size} trận trước → ${r.trend.size} trận gần nhất.`,...r.trend.metrics.map(x=>`- ${x.label}: ${x.available?`${format(x.id==='kp'?x.before*100:x.before)} → ${format(x.id==='kp'?x.after*100:x.after)}${x.id==='kp'?'%':''}`:'Chưa đủ dữ liệu ở mỗi nhóm.'}`)]:[r.trend.reason]),
  '## Giới hạn',...r.limitations.map(x=>'- '+x)].join('\n\n');
}
