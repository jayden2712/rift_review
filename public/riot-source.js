import {InputError} from './data.js';
import {normalizeHistory} from './history-data.js';
export class LiveDataError extends InputError {
  constructor(message,code,retryAfter=0){super([message]);this.code=code;this.retryAfter=retryAfter;}
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
