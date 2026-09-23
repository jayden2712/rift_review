import {t,getLanguage} from './i18n.js';
import {InputError} from './data.js';
import {normalizeHistory} from './history-data.js';

const liveErrorMessages=Object.freeze({
  NETWORK_ERROR:'Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại.',
  BAD_RESPONSE:'Không đọc được phản hồi. Hãy tải lại trang và kiểm tra đăng nhập.',
  SIGN_IN_REQUIRED:'Đăng nhập tài khoản có quyền truy cập web để tra cứu.',
  RIOT_NOT_CONFIGURED:'Chưa cấu hình Riot API key trên máy chủ.',
  RIOT_KEY_REJECTED:'Riot không chấp nhận API key hiện tại. Cần cập nhật key trong phần cấu hình máy chủ.',
  RIOT_RATE_LIMIT:'Riot đang giới hạn yêu cầu. Thử lại sau thời gian được hiển thị.',
  LOCAL_RATE_LIMIT:'Đã gần giới hạn Riot API. Hãy thử lại sau.',
  LOOKUP_BUSY:'Có yêu cầu khác đang tải. Vui lòng đợi vài giây rồi thử lại.',
  RIOT_UNAVAILABLE:'Không kết nối được Riot. Dữ liệu đang xem vẫn được giữ nguyên. Thử lại sau.',
  RIOT_NOT_FOUND:'Không tìm thấy tài khoản hoặc trận trên server đã chọn.',
  WRONG_SERVER:'Riot ID tồn tại nhưng không tìm thấy hồ sơ LoL trên server này. Hãy kiểm tra server.',
  NO_MATCHES:'Tài khoản chưa có lịch sử trận mà Riot trả về ở khu vực này.',
  NO_SUPPORTED_MATCHES:'Không có trận Summoner’s Rift phù hợp trong lịch sử trả về.',
  INVALID_ID:'Riot ID cần dạng Tên#TAG. Giữ đúng dấu và khoảng trắng.',
  INVALID_REGION:'Chọn server của tài khoản League of Legends.',
  INVALID_COUNT:'Mỗi lần tra cứu lấy 10 hoặc 20 trận gần nhất.',
  INVALID_MATCH:'Mã trận không hợp lệ hoặc không thuộc server đã chọn.',
  RIOT_BAD_DATA:'Dữ liệu phản hồi không hợp lệ. Vui lòng thử lại.',
  RIOT_BAD_ACCOUNT:'Dữ liệu phản hồi không hợp lệ. Vui lòng thử lại.',
  RIOT_BAD_LIST:'Dữ liệu phản hồi không hợp lệ. Vui lòng thử lại.',
  ORIGIN_REJECTED:'Yêu cầu không đến từ web này.',
  INPUT_TOO_LARGE:'Dữ liệu yêu cầu quá lớn.',
  SERVER_ERROR:'Máy chủ gặp lỗi. Dữ liệu đang xem được giữ nguyên.'
});
export function localizeLiveError(message,code){
  if(getLanguage()==='vi')return message;
  return t(Object.hasOwn(liveErrorMessages,code)?liveErrorMessages[code]:'Chưa thể hoàn tất yêu cầu. Vui lòng thử lại.');
}

export class LiveDataError extends InputError {
  constructor(message,code,retryAfter=0){super([localizeLiveError(message,code)]);this.rawMessage=message;this.code=code;this.retryAfter=retryAfter;}
}
export const riotDataSource={
  id:'riot',
  async load(query,{fetchImpl=fetch}={}) {
    let response;
    try{response=await fetchImpl('/api/history',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(query),credentials:'same-origin'});}
    catch{throw new LiveDataError('Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại.','NETWORK_ERROR');}
    let payload;try{payload=await response.json();}catch{throw new LiveDataError('Không đọc được phản hồi. Hãy tải lại trang và kiểm tra đăng nhập.','BAD_RESPONSE');}
    if(!response.ok)throw new LiveDataError(payload.error?.message||'Chưa thể tải lịch sử Riot.',payload.error?.code||'REQUEST_FAILED',Number(payload.error?.retryAfter)||0);
    return {history:normalizeHistory(payload.history),details:payload.details||{},meta:{...payload.source,warnings:payload.warnings||[]}};
  }
};

export async function loadLobbyRank(query,{fetchImpl=fetch}={}){
  let response;
  try{response=await fetchImpl('/api/lobby-rank',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(query),credentials:'same-origin'});}
  catch{throw new LiveDataError('Không kết nối được máy chủ để tải rank.','NETWORK_ERROR');}
  let payload;try{payload=await response.json();}catch{throw new LiveDataError('Không đọc được rank lobby.','BAD_RESPONSE');}
  if(!response.ok)throw new LiveDataError(payload.error?.message||'Chưa tải được rank lobby.',payload.error?.code||'REQUEST_FAILED',Number(payload.error?.retryAfter)||0);
  const rank=payload.lobbyRank;
  if(!rank||!['available','partial','unavailable'].includes(rank.status)||rank.basis!=='current'
    ||!Number.isInteger(rank.rankedCount)||!Number.isInteger(rank.totalPlayers)
    ||rank.totalPlayers<0||rank.totalPlayers>10||rank.rankedCount<0||rank.rankedCount>rank.totalPlayers
    ||(rank.label!==null&&typeof rank.label!=='string')||(typeof rank.label==='string'&&rank.label.length>80)){
    throw new LiveDataError('Dữ liệu rank lobby không hợp lệ.','BAD_RESPONSE');
  }
  return rank;
}
