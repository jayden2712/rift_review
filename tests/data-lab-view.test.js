import test from 'node:test';
import assert from 'node:assert/strict';
import {createDemoLabSnapshot} from '../public/data-lab-model.js';
import {renderLabRows,renderLabDetail} from '../public/data-lab-view.js';
import {setLanguage} from '../public/i18n.js';
function record(projection=true){
 const r=createDemoLabSnapshot(1).records[0];
 return {...r,source:'imported',normalized:{...r.normalized,isRemake:null},
  raw:{kind:'riot',projection,provenance:projection?'riot_projection':'riot_original',data:{metadata:{matchId:r.matchId},info:{futureField:'<script>unsafe()</script>'}}},
  completeness:{basic:{status:'complete',missingFields:[]},supplementary:{status:'partial',missingFields:['healing']},remake:{status:'unknown',basis:'unavailable'},timeline:{status:'not_loaded'},fields:[{field:'isRemake',status:'not_collected',affects:[]},{field:'healing',status:'absent',affects:[]},{field:'visionScore',status:'invalid',affects:['visionPerMinute']}]}};
}
test('VI quality labels separate complete basics, unknown remake, timeline and projected raw',()=>{
 setLanguage('vi');const r=record();const rows=renderLabRows({records:[r]}),detail=renderLabDetail(r);
 assert.match(rows,/Thống kê cơ bản: đủ/);assert.match(rows,/Remake: chưa xác định/);
 assert.match(detail,/Dữ liệu nguồn đã rút gọn/);assert.match(detail,/Bổ sung dữ liệu từ Riot/);
 assert.match(detail,/Chưa có timeline/);assert.match(detail,/Không có trong dữ liệu nguồn/);assert.match(detail,/Giá trị không hợp lệ/);
 assert.match(detail,/Tầm nhìn\/phút/);assert.ok(!detail.includes('Phản hồi Riot nguyên bản'));
 assert.ok(!detail.includes('<script>unsafe()'));
});
test('EN original detail is labeled accurately without a refetch action or claiming API completeness',()=>{
 setLanguage('en');const detail=renderLabDetail(record(false));
 assert.match(detail,/Original Riot response/);assert.match(detail,/Basic statistics: complete/);
 assert.match(detail,/Remake: unknown/);assert.match(detail,/Unknown; source does not establish a remake/);assert.match(detail,/Timeline: not loaded/);
 assert.ok(!detail.includes('data-lab-enrich='));assert.match(detail,/Imported/);
 setLanguage('vi');
});
