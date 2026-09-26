import {t} from './i18n.js';
// Data-source boundary: every adapter returns a validated Match v1.
// Future approved sources belong behind a server endpoint; secrets never belong here.
export const ROLES = ['Top', 'Jungle', 'Mid', 'ADC', 'Support'];
export const SAMPLES = {
  learning: {champion:'Ahri',role:'Mid',result:'Defeat',durationMinutes:28,kills:6,deaths:8,assists:9,cs:146,visionScore:18,teamKills:25,notes:'I felt strong in lane, but struggled to stay alive in the later fights.'},
  strong: {champion:'Jinx',role:'ADC',result:'Victory',durationMinutes:32,kills:11,deaths:3,assists:8,cs:246,visionScore:28,teamKills:28,notes:'I focused on farming and following up on team engages.'},
  support: {champion:'Leona',role:'Support',result:'Victory',durationMinutes:30,kills:2,deaths:5,assists:21,cs:34,visionScore:65,teamKills:30,notes:'I tried to place vision with teammates before objectives.'}
};
export class InputError extends Error {
  constructor(messages) {
    const resolve=()=>messages.map(message=>typeof message==='function'?message():message);
    super(resolve().join(' '));
    this.name='InputError';
    Object.defineProperty(this,'messages',{enumerable:true,get:resolve});
  }
}
export function normalizeMatch(input, {allowShort = false} = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new InputError([()=>t("Dán một trận dưới dạng đối tượng JSON. Xem mẫu để biết định dạng.")]);
  const out = {schemaVersion:1}; const errors=[];
  out.champion = typeof input.champion === 'string' ? input.champion.trim() : '';
  if (!out.champion || out.champion.length>40) errors.push(()=>t("Tên tướng cần từ 1–40 ký tự."));
  const mayhem=input.queue==='ARAM Mayhem';
  if(mayhem)out.queue='ARAM Mayhem';
  out.role=mayhem?null:ROLES.find(x=>x.toLowerCase()===String(input.role).toLowerCase());
  if(!mayhem&&!out.role) errors.push(()=>t("Vị trí phải là Top, Jungle, Mid, ADC hoặc Support."));
  out.result=['Victory','Defeat'].find(x=>x.toLowerCase()===String(input.result).toLowerCase());
  if(!out.result) errors.push(()=>t("Kết quả phải là Victory hoặc Defeat."));
  const fields=[['durationMinutes',"Thời lượng",allowShort ? 0.1 : 5,mayhem?180:90,false,false],['kills',"Hạ gục",0,mayhem?1000:100,true,false],['deaths',"Chết",0,mayhem?1000:100,true,false],['assists',"Hỗ trợ",0,mayhem?1000:100,true,false],['cs','CS',0,2000,true,true],['visionScore',"Điểm tầm nhìn",0,500,true,true],['teamKills',"Hạ gục của đội",0,mayhem?5000:200,true,true]];
  for(const [key,label,min,max,integer,optional] of fields) {
    const v=input[key];
    if(v===undefined || v===null || (typeof v==='string' && v.trim()==='')) { if(optional) out[key]=null; else errors.push(()=>t("{label} là bắt buộc.", {label:t(label)})); continue; }
    const n=typeof v==='number'||typeof v==='string'?Number(v):NaN;
    if(!Number.isFinite(n)||n<min||n>max||(integer&&!Number.isInteger(n))) errors.push(()=>t("{label} cần là {type} từ {min} đến {max}.", {label:t(label), type:integer?t('số nguyên'):t('số'), min:min, max:max}));
    else out[key]=n;
  }
  if(out.teamKills!==null && Number.isFinite(out.teamKills) && Number.isFinite(out.kills) && Number.isFinite(out.assists) && out.kills+out.assists>out.teamKills) errors.push(()=>t("Tổng hạ gục của đội phải ít nhất bằng hạ gục + hỗ trợ. Để trống nếu chưa biết."));
  if(input.notes!==undefined && input.notes!==null && typeof input.notes!=='string') errors.push(()=>t("Ghi chú phải là văn bản."));
  out.notes=typeof input.notes==='string'?input.notes.trim():'';
  if(out.notes.length>2000) errors.push(()=>t("Ghi chú không được quá 2.000 ký tự."));
  if(errors.length) throw new InputError(errors);
  return out;
}
export const manualDataSource = {
  id:'manual', label:'Manual match',
  async load(payload) { return normalizeMatch(payload); }
};
export const jsonDataSource = {
  id:'json', label:'Pasted JSON',
  async load(payload) {
    if(typeof payload!=='string'||payload.length>20000) throw new InputError([()=>t("Dán đối tượng JSON dưới 20.000 ký tự.")]);
    let obj; try {obj=JSON.parse(payload);} catch {throw new InputError([()=>t("Không đọc được JSON. Kiểm tra dấu nháy kép, dấu phẩy, dấu ngoặc hoặc tải mẫu.")]);}
    return normalizeMatch(obj);
  }
};
