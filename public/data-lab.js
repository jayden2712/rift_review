import {onLanguageChange,getLanguage} from './i18n.js';
import {createLabSnapshot,exportLabSnapshot,LAB_MAX_BYTES} from './data-lab-model.js';
import {analyzeLabSnapshot,exportCoachingInput} from './data-lab-findings.js';
import {labText as tr,escapeLab as e,sourceLabel,labColumns,renderLabRows,renderLabAggregate,renderLabFindings} from './data-lab-view.js';
import {localizeLiveError} from './riot-source.js';
const label=(vi,en)=>`<span data-lab-vi="${e(vi)}" data-lab-en="${e(en)}">${tr(vi,en)}</span>`;
const button=(id,vi,en,kind='secondary-btn')=>`<button id="${id}" type="button" class="${kind}">${label(vi,en)}</button>`;
function download(value,name){const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
async function api(path,body){
 const response=await fetch('/api/lab/'+path,{method:body===undefined?'GET':'POST',credentials:'same-origin',headers:body===undefined?{}:{'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
 let data;try{data=await response.json();}catch{throw new Error(tr('Không đọc được phản hồi Data Lab.','Cannot read the Data Lab response.'));}
 if(!response.ok){
  const code=data.error?.code;
  const errors={
   LAB_STORAGE_ERROR:tr('Không thể truy cập dữ liệu Data Lab local.','Cannot access local Data Lab storage.'),
   LAB_STORAGE_FULL:tr('Đã đạt 100 snapshot. Sao lưu và dọn thư mục .local/data-lab/ trước khi lưu thêm.','The 100-snapshot limit was reached. Back up and clean .local/data-lab/ before saving more.'),
   INVALID_LAB_DATA:tr('Snapshot không hợp lệ hoặc vượt giới hạn 20 trận.','The snapshot is invalid or exceeds 20 matches.'),
   INVALID_CONTENT:tr('Dữ liệu cần có định dạng JSON.','Data must use JSON format.'),
   INVALID_JSON:tr('JSON không hợp lệ. Kiểm tra lại nội dung.','Invalid JSON. Check the input.'),
   LAB_PLAYER_UNKNOWN:tr('Snapshot chưa đủ định danh người chơi để bổ sung an toàn. Hãy tra cứu lại Riot ID trong Data Lab.','The snapshot lacks a reliable player identity. Fetch the Riot ID again in Data Lab.'),
   LAB_NOT_PROJECTED:tr('Chỉ bổ sung trận có dữ liệu Riot đã rút gọn.','Only matches with projected Riot data can be enriched.'),
   PLAYER_MISMATCH:tr('Chi tiết Riot không khớp người chơi của snapshot. Dữ liệu cũ được giữ nguyên.','Riot detail does not match the snapshot player. Existing data is preserved.'),
   NOT_FOUND:tr('Không tìm thấy snapshot hoặc Data Lab chưa được bật.','Snapshot not found or Data Lab is disabled.')
  };
  throw new Error(errors[code]||localizeLiveError(data.error?.message||tr('Yêu cầu Data Lab thất bại.','Data Lab request failed.'),code));
 }
 return data;
}
function shell(){return `
<header class="lab-heading"><div><span class="eyebrow">LOCAL DEVELOPMENT</span><h1>Data Lab</h1><p>${label('Kiểm tra dữ liệu và bằng chứng trước khi tích hợp AI.','Inspect data and evidence before integrating AI.')}</p></div>${button('lab-close','Về lịch sử trận','Back to history')}</header>
<p class="lab-notice">${label('Chỉ hoạt động khi bật phát triển local. Snapshot lưu ở .local/data-lab/ trên máy này, không gửi tới nhà cung cấp AI.','Available only with local development enabled. Snapshots are saved to .local/data-lab/ on this computer; nothing is sent to an AI provider.')}</p>
<section class="panel lab-inputs"><form id="lab-riot-form" class="lab-lookup"><label>Riot ID<input name="riotId" maxlength="100" placeholder="Name#TAG" required></label><label>Server<select name="region">${['oce','vn','kr','jp','na','euw','eune','br','lan','las','tr','ru','sg','tw'].map(region=>`<option value="${region}">${region.toUpperCase()}</option>`).join('')}</select></label><label>${label('Số trận','Matches')}<select name="count"><option value="10">10</option><option value="20">20</option></select></label><button type="submit" id="lab-collect" class="primary-btn">${label('Tra cứu Riot & lưu','Fetch Riot & save')}</button></form>
<div class="lab-actions">${button('lab-demo','Dùng Demo SR','Use SR demo')}${button('lab-current','Dùng lịch sử đang xem','Use current history')}${button('lab-save','Lưu snapshot','Save snapshot')}${button('lab-export','Xuất snapshot JSON','Export snapshot JSON')}${button('lab-export-coaching','Xuất Coaching input JSON','Export Coaching input JSON')}</div>
<details id="lab-import-box"><summary>${label('Nhập History JSON hoặc snapshot','Import History JSON or snapshot')}</summary><p class="small muted">${label('Tối đa 20 trận / 8 MiB. Dữ liệu nhập không được coi là Riot đã xác minh.','Up to 20 matches / 8 MiB. Imported data is not treated as verified Riot data.')}</p><label class="file-label">${label('Chọn file JSON','Choose JSON file')}<input id="lab-import-file" type="file" accept=".json,application/json"></label><label for="lab-import-json">JSON</label><textarea id="lab-import-json" rows="6" maxlength="${LAB_MAX_BYTES}" spellcheck="false"></textarea>${button('lab-import','Kiểm tra & nhập','Validate & import')}</details>
<div class="lab-saved"><label>${label('Snapshot trên máy','Saved snapshots')}<select id="lab-saved-list"><option value="">—</option></select></label>${button('lab-load','Mở bản lưu','Open saved snapshot')}${button('lab-refresh-list','Làm mới danh sách','Refresh list')}</div></section>
<p id="lab-error" class="error-box" role="alert" hidden></p><p id="lab-status" role="status" aria-live="polite"></p><p id="lab-dataset-status" class="small muted"></p>
<div class="lab-tab-list" role="tablist" aria-label="Data Lab"><button type="button" id="lab-data-tab" role="tab" aria-controls="lab-data-panel" aria-selected="true">${label('Dữ liệu','Data')}</button><button type="button" id="lab-coaching-tab" role="tab" aria-controls="lab-coaching-panel" aria-selected="false" tabindex="-1">${label('Coaching / Bằng chứng','Coaching / Evidence')}</button></div>
<form id="lab-filters" class="lab-filters"><label>${label('Vị trí','Role')}<select name="role"><option value="">${tr('Tất cả','All')}</option></select></label><label>${label('Tướng','Champion')}<select name="champion"><option value="">${tr('Tất cả','All')}</option></select></label><label>${label('Chế độ','Queue')}<select name="queue"><option value="">${tr('Tất cả','All')}</option></select></label><label>${label('Kết quả','Result')}<select name="result"><option value="">${tr('Tất cả','All')}</option><option value="Victory">${tr('Thắng','Victory')}</option><option value="Defeat">${tr('Thua','Defeat')}</option></select></label><label>${label('Giới hạn nhóm','Cohort limit')}<select name="limit"><option value="10">10</option><option value="20" selected>20</option></select></label>${button('lab-reset','Đặt lại bộ lọc','Reset filters','text-btn')}</form><p id="lab-scope" class="scope" role="status"></p>
<section id="lab-data-panel" role="tabpanel" aria-labelledby="lab-data-tab"><div class="lab-table-scroll lab-match-table-scroll" tabindex="0"><table id="lab-data-table"><thead></thead><tbody></tbody></table></div><p class="small muted">${label('Bấm một hàng hoặc nút Chi tiết để mở/đóng thống kê ngay dưới trận. Bấm tiêu đề cột để sắp xếp.','Select a row or Details to expand/collapse its statistics below the match. Select a column heading to sort.')}</p><details class="lab-summary" open><summary>${label('Thống kê nhóm đủ điều kiện','Eligible cohort statistics')}</summary><p class="small muted">${label('Mỗi chỉ số chỉ dùng các trận đủ điều kiện có đầy đủ tử số và mẫu số dương. Tỷ lệ từ tổng khác trung bình tỷ lệ từng trận.','Each metric uses eligible matches with known numerators and positive denominators. A pooled ratio differs from the mean of per-match ratios.')}</p><div id="lab-aggregate"></div></details></section>
<section id="lab-coaching-panel" role="tabpanel" aria-labelledby="lab-coaching-tab" hidden></section>`;}
export function mountDataLab({getCurrent}){
 if(document.querySelector('#open-data-lab'))return;
 const style=document.createElement('link');style.rel='stylesheet';style.href='/data-lab.css';document.head.append(style);
 const root=document.createElement('section');root.id='data-lab';root.hidden=true;root.innerHTML=shell();document.querySelector('main').append(root);
 const launch=document.createElement('button');launch.id='open-data-lab';launch.type='button';launch.className='text-btn';launch.textContent='Data Lab';document.querySelector('.site-header nav').append(launch);
 const $=selector=>root.querySelector(selector);
 let snapshot=null,analysis=null,selected=null,currentTab='data',sortBy='playedAt',direction='desc',busy=false,savedID=null,savedList=[],previousVisibility=[];
 const inputForm=$('#lab-riot-form');for(const key of ['riotId','region'])inputForm.elements[key].value=document.querySelector('#riot-lookup')?.elements[key]?.value||'';
 function showError(error){$('#lab-error').textContent=(error?.code==='INVALID_LAB_DATA'?tr('Dữ liệu nhập không hợp lệ. Cần History JSON hoặc snapshot hỗ trợ, từ 1 đến 20 trận có ID duy nhất.','Invalid input. Use supported History JSON or a snapshot with 1–20 matches and unique IDs.'):error instanceof SyntaxError?tr('JSON không hợp lệ. Kiểm tra dấu ngoặc, dấu phẩy và dấu nháy.','Invalid JSON. Check brackets, commas and quotes.'):error?.messages?.join(' ')||error.message)||tr('Không đọc được dữ liệu.','Cannot read the data.');$('#lab-error').hidden=false;}
 async function run(action){if(busy)return;const previousSnapshot=snapshot;busy=true;$('#lab-error').hidden=true;$('#lab-status').textContent=tr('Đang xử lý…','Working…');root.setAttribute('aria-busy','true');for(const el of root.querySelectorAll('button,input,select,textarea'))el.disabled=true;
  try{await action();$('#lab-status').textContent=tr('Đã hoàn tất.','Done.');}catch(error){showError(error);$('#lab-status').textContent=snapshot===previousSnapshot?tr('Dữ liệu đang xem được giữ nguyên.','The current dataset is preserved.'):tr('Dữ liệu đã cập nhật, nhưng không thể hoàn tất thao tác tiếp theo.','The dataset was updated, but the follow-up operation could not be completed.');}
  finally{busy=false;root.removeAttribute('aria-busy');for(const el of root.querySelectorAll('button,input,select,textarea'))el.disabled=false;updateButtons();}
 }
 function updateButtons(){for(const id of ['lab-save','lab-export','lab-export-coaching'])$('#'+id).disabled=busy||!snapshot;$('#lab-load').disabled=busy||!$('#lab-saved-list').value;}
 function filterOptions(){const form=$('#lab-filters');for(const field of ['role','champion','queue']){const current=form.elements[field].value,values=[...new Set(snapshot?.records.map(r=>r.normalized[field]).filter(Boolean)||[])].sort();form.elements[field].innerHTML=`<option value="">${tr('Tất cả','All')}</option>`+values.map(value=>`<option value="${e(value)}">${e(value)}</option>`).join('');if(values.includes(current))form.elements[field].value=current;}form.elements.result.options[0].textContent=tr('Tất cả','All');form.elements.result.options[1].textContent=tr('Thắng','Victory');form.elements.result.options[2].textContent=tr('Thua','Defeat');}
 function setSnapshot(next,id=null,preserveView=false){snapshot=next;savedID=id;if(!preserveView){selected=null;sortBy='playedAt';direction='desc';$('#lab-filters').reset();}filterOptions();render();}
 function render(){
  const headers=labColumns().map(([key,name])=>`<th scope="col"${sortBy===key?` aria-sort="${direction==='asc'?'ascending':'descending'}"`:''}>${key==='source'?e(name):`<button type="button" data-lab-sort="${key}">${e(name)}${sortBy===key?(direction==='asc'?' ↑':' ↓'):''}</button>`}</th>`).join('');$('#lab-data-table thead').innerHTML=`<tr>${headers}</tr>`;
  updateButtons();if(!snapshot){$('#lab-dataset-status').textContent=tr('Chưa có dữ liệu. Chọn Demo, dùng lịch sử hiện tại hoặc tra cứu Riot.','No dataset yet. Choose Demo, use current history, or fetch Riot.');return;}
  const filters={...Object.fromEntries([...$('#lab-filters').elements].filter(el=>el.name).map(el=>[el.name,el.value])),sortBy,direction};analysis=analyzeLabSnapshot(snapshot,filters);
  const s=analysis.scope;$('#lab-dataset-status').textContent=`${sourceLabel(snapshot.source)} · ${snapshot.records.length} ${tr('trận','matches')} · ${snapshot.collectedAt}${savedID?` · ${tr('Đã lưu','Saved')}: ${savedID}`:''}`;
  $('#lab-scope').textContent=`${s.filteredCount}/${s.inputCount} ${tr('trận khớp bộ lọc','matches match filters')} · ${s.selectedCount} ${tr('trận trong nhóm','selected')} · ${s.eligibleCount} ${tr('đủ điều kiện coaching','eligible for coaching')} · ${s.excludedCount} ${tr('bị loại khỏi coaching','excluded from coaching')}. ${tr('Bộ lọc','Filters')}: ${[s.role,s.champion,s.queue,s.result].filter(Boolean).join(' / ')||tr('Tất cả','All')}`;
  if(!analysis.records.some(record=>record.matchId===selected))selected=null;
  $('#lab-data-table tbody').innerHTML=renderLabRows(analysis,selected);$('#lab-aggregate').innerHTML=renderLabAggregate(analysis.aggregate);$('#lab-coaching-panel').innerHTML=renderLabFindings(analysis);
  if(busy)for(const el of root.querySelectorAll('button,input,select,textarea'))el.disabled=true;
 }
 function tab(name){currentTab=name;for(const key of ['data','coaching']){const active=key===name;$('#lab-'+key+'-tab').setAttribute('aria-selected',String(active));$('#lab-'+key+'-tab').tabIndex=active?0:-1;$('#lab-'+key+'-panel').hidden=!active;}}
 function renderSaved(){const value=$('#lab-saved-list').value;$('#lab-saved-list').innerHTML='<option value="">—</option>'+savedList.map(item=>`<option value="${e(item.id)}">${e(item.collectedAt)} · ${e(sourceLabel(item.source))} · ${e(item.count)}</option>`).join('');if(savedList.some(item=>item.id===(savedID||value)))$('#lab-saved-list').value=savedID||value;updateButtons();}
 async function refreshSaved(){const result=await api('snapshots');savedList=result.snapshots;renderSaved();}
 function close(){root.hidden=true;for(const [element,hidden] of previousVisibility)element.hidden=hidden;launch.focus();}
 launch.addEventListener('click',()=>{if(!root.hidden)return;previousVisibility=[...document.querySelector('main').children].filter(el=>el!==root).map(el=>[el,el.hidden]);for(const [element] of previousVisibility)element.hidden=true;root.hidden=false;root.scrollIntoView({block:'start'});run(refreshSaved);});
 $('#lab-close').addEventListener('click',close);
 for(const link of document.querySelectorAll('.site-header [data-view],.site-header a[href="#method"]'))link.addEventListener('click',()=>{if(!root.hidden)close();});
 $('#lab-demo').addEventListener('click',()=>run(async()=>{const result=await api('demo',{count:Number(inputForm.elements.count.value)});setSnapshot(result.snapshot);}));
 $('#lab-current').addEventListener('click',()=>run(async()=>{const current=getCurrent(),count=Number(inputForm.elements.count.value),matches=current.history.matches.slice(0,count),ids=new Set(matches.map(m=>m.id));const payload={...current.history,matches,details:Object.fromEntries(Object.entries(current.history.details||{}).filter(([id])=>ids.has(id)))};setSnapshot(createLabSnapshot(payload,{source:current.source==='sample'?'demo':'imported',...(current.source==='riot'?{historyProvenance:'riot_projection'}:{})}));}));
 inputForm.addEventListener('submit',event=>{event.preventDefault();const query=Object.fromEntries(new FormData(inputForm));run(async()=>{const result=await api('collect',{...query,count:Number(query.count)});setSnapshot(result.snapshot,result.id);await refreshSaved();});});
 $('#lab-save').addEventListener('click',()=>run(async()=>{const result=await api('snapshots',{snapshot:exportLabSnapshot(snapshot)});setSnapshot(result.snapshot,result.id);await refreshSaved();}));
 $('#lab-load').addEventListener('click',()=>run(async()=>{const result=await api('snapshots/'+encodeURIComponent($('#lab-saved-list').value));setSnapshot(result.snapshot,result.id);}));
 $('#lab-refresh-list').addEventListener('click',()=>run(refreshSaved));$('#lab-saved-list').addEventListener('change',updateButtons);
 $('#lab-import').addEventListener('click',()=>run(async()=>{const value=$('#lab-import-json').value;if(new TextEncoder().encode(value).length>LAB_MAX_BYTES)throw new Error(tr('JSON vượt giới hạn 8 MiB.','JSON exceeds the 8 MiB limit.'));const input=JSON.parse(value);const next=createLabSnapshot(input,{source:input.source==='demo'?'demo':'imported'});setSnapshot(next);}));
 $('#lab-import-file').addEventListener('change',event=>{const file=event.target.files[0];if(!file)return;run(async()=>{if(file.size>LAB_MAX_BYTES)throw new Error(tr('File cần nhỏ hơn 8 MiB.','File must be under 8 MiB.'));$('#lab-import-json').value=await file.text();});event.target.value='';});
 $('#lab-export').addEventListener('click',()=>{try{download(exportLabSnapshot(snapshot),'rift-review-data-lab.json');}catch(error){showError(error);}});
 $('#lab-export-coaching').addEventListener('click',()=>{try{download(exportCoachingInput(analysis),'rift-review-coaching-input.json');}catch(error){showError(error);}});
 $('#lab-data-tab').addEventListener('click',()=>tab('data'));$('#lab-coaching-tab').addEventListener('click',()=>tab('coaching'));
 $('.lab-tab-list').addEventListener('keydown',event=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){event.preventDefault();tab(event.key==='Home'?'data':event.key==='End'?'coaching':currentTab==='data'?'coaching':'data');$('#lab-'+currentTab+'-tab').focus();}});
 $('#lab-filters').addEventListener('submit',event=>event.preventDefault());$('#lab-filters').addEventListener('change',render);
 $('#lab-reset').addEventListener('click',()=>{$('#lab-filters').reset();render();});
 function openMatch(id,fromEvidence=false){
  selected=fromEvidence||selected!==id?id:null;tab('data');render();
  const toggle=[...root.querySelectorAll('[data-lab-match]')].find(button=>button.dataset.labMatch===id);
  if(fromEvidence){const detail=$('#lab-detail');detail?.scrollIntoView({block:'start',behavior:'smooth'});detail?.focus({preventScroll:true});}
  else toggle?.focus({preventScroll:true});
 }
 root.addEventListener('click',event=>{
  if(busy)return;
  const target=event.target.closest('button');
  if(target?.dataset.labEnrich){const matchId=target.dataset.labEnrich;run(async()=>{const result=await api('enrich',{snapshot:exportLabSnapshot(snapshot),matchId});setSnapshot(result.snapshot,result.id,true);await refreshSaved();});return;}
  if(target?.dataset.labSort){direction=sortBy===target.dataset.labSort&&direction==='desc'?'asc':'desc';sortBy=target.dataset.labSort;render();return;}
  if(target?.dataset.labEvidence){openMatch(target.dataset.labEvidence,true);return;}
  const id=target?.dataset.labMatch||target?.dataset.labCloseMatch;
  if(id){openMatch(id);return;}
  const row=event.target.closest('[data-lab-row]');
  if(row&&!event.target.closest('button,a,input,select,textarea,summary')&&window.getSelection()?.isCollapsed!==false)openMatch(row.dataset.labRow);
 });
 onLanguageChange(()=>{for(const element of root.querySelectorAll('[data-lab-vi]'))element.textContent=getLanguage()==='en'?element.dataset.labEn:element.dataset.labVi;filterOptions();renderSaved();render();tab(currentTab);});
 filterOptions();render();
}
