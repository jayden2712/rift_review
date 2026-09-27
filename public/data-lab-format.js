import {getLanguage,getLocale} from './i18n.js';
export const labText=(vi,en)=>getLanguage()==='en'?en:vi;
export const escapeLab=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const e=escapeLab,tr=labText;
export const numeric=value=>Number.isFinite(value)?new Intl.NumberFormat(getLocale(),{maximumFractionDigits:2}).format(value):'—';
const percentKeys=new Set(['killParticipation','damageShare','goldShare']);
export function metricLabel(key){return ({csPerMinute:tr('CS/phút','CS/min'),goldPerMinute:tr('Vàng/phút','Gold/min'),killParticipation:tr('Tham gia hạ gục','Kill participation'),damageShare:tr('Tỷ trọng sát thương','Damage share'),goldShare:tr('Tỷ trọng vàng','Gold share'),kda:'KDA',visionPerMinute:tr('Tầm nhìn/phút','Vision/min'),deathsPer30:tr('Chết/30 phút','Deaths/30 min')})[key]||key;}
export function metricValue(key,value,status){if(status==='deathless')return tr('Không chết','Deathless');return Number.isFinite(value)?numeric(percentKeys.has(key)?value*100:value)+(percentKeys.has(key)?'%':''):'—';}
export function sourceLabel(source){return source==='demo'?'Demo':source==='riot'?'Riot':tr('Đã nhập','Imported');}
export function exclusionLabel(code){return ({remake:tr('Trận remake','Remake'),short_game:tr('Trận dưới 5 phút','Under five minutes'),unknown_role:tr('Chưa biết vị trí','Unknown role'),invalid_duration:tr('Thời lượng không hợp lệ','Invalid duration'),unsupported_queue:tr('Ngoài phạm vi SR','Outside SR scope'),missing_coaching_fields:tr('Thiếu dữ liệu coaching bắt buộc','Missing required coaching data'),missing_core_data:tr('Thiếu dữ liệu bắt buộc','Missing required data')})[String(code).toLowerCase()]||String(code);}
