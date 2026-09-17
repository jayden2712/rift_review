// Data-source boundary: every adapter returns a validated Match v1.
// Future approved sources belong behind a server endpoint; secrets never belong here.
export const ROLES = ['Top', 'Jungle', 'Mid', 'ADC', 'Support'];
export const SAMPLES = {
  learning: {champion:'Ahri',role:'Mid',result:'Defeat',durationMinutes:28,kills:6,deaths:8,assists:9,cs:146,visionScore:18,teamKills:25,notes:'I felt strong in lane, but struggled to stay alive in the later fights.'},
  strong: {champion:'Jinx',role:'ADC',result:'Victory',durationMinutes:32,kills:11,deaths:3,assists:8,cs:246,visionScore:28,teamKills:28,notes:'I focused on farming and following up on team engages.'},
  support: {champion:'Leona',role:'Support',result:'Victory',durationMinutes:30,kills:2,deaths:5,assists:21,cs:34,visionScore:65,teamKills:30,notes:'I tried to place vision with teammates before objectives.'}
};
export class InputError extends Error {
  constructor(messages) { super(messages.join(' ')); this.name='InputError'; this.messages=messages; }
}
export function normalizeMatch(input, {allowShort = false} = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new InputError(['Paste one match as a JSON object. Use the example to see the format.']);
  const out = {schemaVersion:1}; const errors=[];
  out.champion = typeof input.champion === 'string' ? input.champion.trim() : '';
  if (!out.champion || out.champion.length>40) errors.push('Champion must contain 1–40 characters.');
  out.role=ROLES.find(x=>x.toLowerCase()===String(input.role).toLowerCase());
  if(!out.role) errors.push('Role must be Top, Jungle, Mid, ADC, or Support.');
  out.result=['Victory','Defeat'].find(x=>x.toLowerCase()===String(input.result).toLowerCase());
  if(!out.result) errors.push('Result must be Victory or Defeat.');
  const fields=[['durationMinutes','Duration',allowShort ? 0.1 : 5,90,false,false],['kills','Kills',0,100,true,false],['deaths','Deaths',0,100,true,false],['assists','Assists',0,100,true,false],['cs','CS',0,2000,true,true],['visionScore','Vision score',0,500,true,true],['teamKills','Team kills',0,200,true,true]];
  for(const [key,label,min,max,integer,optional] of fields) {
    const v=input[key];
    if(v===undefined || v===null || (typeof v==='string' && v.trim()==='')) { if(optional) out[key]=null; else errors.push(`${label} is required.`); continue; }
    const n=typeof v==='number'||typeof v==='string'?Number(v):NaN;
    if(!Number.isFinite(n)||n<min||n>max||(integer&&!Number.isInteger(n))) errors.push(`${label} must be ${integer?'a whole number':'a number'} from ${min} to ${max}.`);
    else out[key]=n;
  }
  if(out.teamKills!==null && Number.isFinite(out.teamKills) && Number.isFinite(out.kills) && Number.isFinite(out.assists) && out.kills+out.assists>out.teamKills) errors.push('Team kills must be at least kills + assists. Leave it blank if unknown.');
  if(input.notes!==undefined && input.notes!==null && typeof input.notes!=='string') errors.push('Reflection must be text.');
  out.notes=typeof input.notes==='string'?input.notes.trim():'';
  if(out.notes.length>2000) errors.push('Reflection must be 2,000 characters or fewer.');
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
    if(typeof payload!=='string'||payload.length>20000) throw new InputError(['Paste a JSON object under 20,000 characters.']);
    let obj; try {obj=JSON.parse(payload);} catch {throw new InputError(['That JSON could not be read. Check double quotes, commas, and brackets, or load the example.']);}
    return normalizeMatch(obj);
  }
};
