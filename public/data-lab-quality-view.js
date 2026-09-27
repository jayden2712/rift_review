import {labText as tr,escapeLab as e,metricLabel,exclusionLabel} from './data-lab-format.js';

function groupLabel(group){
 const count=group?.missingFields?.length??0;
 return group?.status==='complete'?tr('đủ','complete'):tr(`thiếu ${count} trường`,`missing ${count} fields`);
}
function remakeLabel(record){
 const status=record.completeness.remake?.status;
 return status==='yes'?tr('có','yes'):status==='no'?tr('không','no'):tr('chưa xác định','unknown');
}
function original(record){return record.raw.kind==='riot'&&record.raw.projection===false&&record.raw.provenance==='riot_original';}
function projected(record){return record.raw.provenance==='riot_projection'&&record.raw.projection===true;}
function rawLabel(record){
 if(original(record))return tr('nguyên bản (match detail)','original (match detail)');
 if(projected(record))return tr('đã rút gọn','projected');
 if(record.raw.provenance==='demo'||record.source==='demo')return 'Demo';
 return record.raw.kind==='unavailable'?tr('chưa thu thập','not collected'):tr('dữ liệu nhập / lịch sử đã chuẩn hóa','manual / normalized history');
}
export function renderLabStatus(record,compact=false){
 const c=record.completeness;
 const lines=[
  `${tr('Thống kê cơ bản','Basic statistics')}: ${groupLabel(c.basic)}`,
  `${tr('Thống kê bổ sung','Additional statistics')}: ${groupLabel(c.supplementary)}`,
  `${tr('Dữ liệu nguồn','Source data')}: ${rawLabel(record)}`,
  `Remake: ${remakeLabel(record)}`,
  tr('Timeline: chưa tải','Timeline: not loaded'),
  `Coaching: ${record.coaching.eligible?tr('khả dụng','available'):tr('bị loại','excluded')}`,
 ];
 return `<div class="${compact?'lab-quality-compact':'lab-quality-status'}">${lines.map(line=>`<${compact?'small':'p'}>${e(line)}</${compact?'small':'p'}>`).join('')}</div>`;
}
function fieldLabel(field){
 return ({champion:tr('Tướng','Champion'),role:tr('Vị trí','Role'),queue:tr('Chế độ','Queue'),result:tr('Kết quả','Result'),durationSeconds:tr('Thời lượng','Duration'),kills:'Kills',deaths:'Deaths',assists:'Assists',cs:'CS',goldEarned:tr('Vàng kiếm được','Gold earned'),damageToChampions:tr('Sát thương lên tướng','Damage to champions'),teamKills:tr('Hạ gục của đội','Team kills'),visionScore:tr('Điểm tầm nhìn','Vision score'),healing:tr('Hồi máu','Healing'),shielding:tr('Lá chắn cho đồng đội','Shielding to teammates'),damageTaken:tr('Sát thương nhận','Damage taken'),laneMinions:tr('Lính đường','Lane minions'),neutralMinions:tr('Quái rừng','Neutral minions'),wardsPlaced:tr('Mắt đã cắm','Wards placed'),wardsKilled:tr('Mắt đã phá','Wards destroyed'),controlWardsPlaced:tr('Mắt kiểm soát đã cắm','Control wards placed'),controlWardsBought:tr('Mắt kiểm soát đã mua','Control wards bought'),items:tr('Trang bị cuối trận','Final inventory'),participants:tr('Dữ liệu participant','Participant data'),playedAt:tr('Thời gian trận','Match time'),gameVersion:tr('Phiên bản','Patch'),queueId:'Queue ID',mapId:'Map ID',teamId:'Team ID',isRemake:'Remake',timeline:'Timeline'})[field]||field;
}
function fieldStatus(status,field){
 if(field==='isRemake')return tr('Chưa xác định; nguồn không xác nhận remake','Unknown; source does not establish a remake');
 if(field==='timeline')return tr('Chưa tải timeline','Timeline not loaded');
 return ({not_collected:tr('Chưa thu thập / không còn trong dữ liệu rút gọn','Not collected / unavailable in projection'),absent:tr('Không có trong dữ liệu nguồn','Absent from source data'),invalid:tr('Giá trị không hợp lệ','Invalid value')})[status]||status;
}
export function renderLabQuality(record){
 const missing=(record.completeness.fields||[]).filter(field=>field.status!=='available');
 const policy=tr('Chính sách coaching: remake chưa xác định vẫn được xét nếu các điều kiện khác đạt. Trận remake được xác nhận, dưới 5 phút, trên 90 phút, ngoài SR hoặc thiếu dữ liệu coaching bắt buộc bị loại. Early surrender không được coi là bằng chứng xác nhận remake.','Coaching policy: unknown remake status is allowed only when all other checks pass. Confirmed remakes, games under 5 or over 90 minutes, non-SR modes, or missing required coaching fields are excluded. Early surrender does not confirm a remake.');
 return `<section class="lab-quality"><h4>${tr('Trạng thái dữ liệu','Data quality')}</h4>${renderLabStatus(record)}<p class="small muted">${e(policy)}</p>${record.completeness.remake?.basis==='unsupported_projection_inference'?`<p class="small muted">${tr('Cờ remake trong lịch sử Riot rút gọn do bộ chuyển đổi cũ gán, không phải Riot xác nhận. Giữ nguyên giá trị nguồn nhưng để trạng thái chuẩn hóa là chưa xác định.','The reduced Riot history contains a remake flag assigned by the old adapter, not confirmed by Riot. The source value is preserved while the normalized status remains unknown.')}</p>`:''}${!record.coaching.eligible?`<p>${tr('Lý do bị loại','Exclusion reasons')}: ${record.coaching.reasons.map(exclusionLabel).map(e).join(' · ')}</p>`:''}${missing.length?`<div class="lab-table-scroll"><table class="lab-missing-fields"><thead><tr><th>${tr('Trường','Field')}</th><th>${tr('Trạng thái','Status')}</th><th>${tr('Ảnh hưởng đến','Affects')}</th></tr></thead><tbody>${missing.map(field=>`<tr><td>${e(fieldLabel(field.field))}<small>${e(field.field)}</small></td><td>${e(fieldStatus(field.status,field.field))}</td><td>${field.affects?.length?field.affects.map(metricLabel).map(e).join(', '):tr('Thông tin bổ sung / giới hạn phân tích','Additional context / analysis limitations')}</td></tr>`).join('')}</tbody></table></div>`:`<p class="small muted">${tr('Không thiếu trường thống kê được kiểm tra. Timeline vẫn chưa được tải.','No missing checked statistics. Timeline has not been loaded.')}</p>`}</section>`;
}
export function renderLabRaw(record){
 const title=original(record)?tr('Phản hồi Riot nguyên bản','Original Riot response'):projected(record)?tr('Dữ liệu nguồn đã rút gọn','Projected source data'):record.source==='demo'?'Demo JSON':tr('Dữ liệu nguồn có sẵn','Available source data');
 const description=original(record)?tr('Toàn bộ JSON body của match detail được lưu riêng, không gồm request headers. Đây không phải toàn bộ Riot API; timeline là nguồn riêng chưa tải. Dữ liệu nhập từ file giữ provenance nhưng chưa được xác minh lại với Riot.','The complete match-detail JSON body is stored separately, without request headers. This is not the whole Riot API; timeline is a separate source and has not been loaded. Imported files retain provenance but are not reverified with Riot.'):
 projected(record)?tr('Snapshot này đã bỏ bớt trường. Không thể khôi phục các trường đó từ dữ liệu chuẩn hóa; cần lấy lại match detail từ Riot.','Fields were removed from this snapshot. Normalized data cannot restore them; fetch the match detail from Riot again.'):
 tr('Nguồn nhập hoặc lịch sử đã chuẩn hóa; không có phản hồi Riot nguyên bản.','Manual or normalized history source; the original Riot response is unavailable.');
 const historyNote=projected(record)&&record.raw.kind==='history'?`<p class="small muted">${tr('Để lấy lại nguyên bản cho nguồn lịch sử đã chuẩn hóa, dùng Tra cứu Riot & lưu ở đầu Data Lab.','For normalized history sources, use Fetch Riot & save at the top of Data Lab to collect original data.')}</p>`:'';
 const action=projected(record)&&record.raw.kind==='riot'?`<div class="lab-enrich"><button type="button" class="secondary-btn" data-lab-enrich="${e(record.matchId)}">${tr('Bổ sung dữ liệu từ Riot','Fetch original data from Riot')}</button><p class="small muted">${tr('Chỉ tải match detail của trận này và lưu thành snapshot mới. Bản lưu cũ được giữ nguyên.','Fetch only this match detail and save a new snapshot. The previous saved file is retained.')}</p></div>`:'';
 return `${historyNote}${action}<details class="lab-json lab-raw"><summary>${e(title)}</summary><p class="small muted">${e(description)}</p><pre>${e(JSON.stringify(record.raw.data,null,2))}</pre></details>`;
}
