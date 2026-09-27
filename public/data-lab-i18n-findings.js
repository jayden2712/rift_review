import {getLanguage} from './i18n.js';

const messages={
 observed:['{known}/{eligible} trận đủ dữ liệu cho {metric}; {flagged} trận vượt ngưỡng xem lại minh họa.','{known}/{eligible} eligible matches have {metric} data; {flagged} cross an illustrative review threshold.'],
 hypothesis:['{metric} là tín hiệu để chọn tình huống xem lại. Bảng cuối trận chưa xác định được nguyên nhân hay chất lượng quyết định.','{metric} is a signal for selecting situations to review. End-of-game statistics cannot establish causes or decision quality.'],
 survival:['Số lần chết / 30 phút','Deaths / 30 minutes'],
 farm:['CS / phút','CS / minute'],
 vision:['Điểm tầm nhìn / phút','Vision score / minute'],
 involvement:['Tham gia hạ gục','Kill participation'],
 survivalAction:['Xem lại tối đa 3 lần chết. Ghi thông tin có sẵn trước tình huống, đường rút và giá trị pha đổi mạng; giữ nguyên “chưa rõ” khi thiếu bằng chứng.','Review up to 3 deaths. Record the information available beforehand, escape options and the value of the trade; keep an “unclear” label when evidence is missing.'],
 farmAction:['Xem lại một lần biến về hoặc di chuyển và các nguồn CS có thể lấy an toàn. Với Jungle, xem một đoạn di chuyển giữa các camp. Chưa kết luận đã bỏ lính từ CS cả trận.','Review one recall or rotation and the CS that could safely be collected. For Jungle, review a route between camps. Total CS alone does not establish missed waves.'],
 visionAction:['Xem lại tầm nhìn trước tối đa 2 mục tiêu, thời điểm dùng phụ kiện và khả năng đi cùng đồng đội. Kiểm tra chất lượng vị trí mắt trong replay nếu có.','Review vision before up to 2 objectives, trinket timing and whether a teammate could accompany you. Check ward placement quality in a replay if available.'],
 involvementAction:['Xem lại tối đa 2 giao tranh và lựa chọn tham gia hoặc đổi mục tiêu. Ghi lý do và thông tin có sẵn; KP không xác định lựa chọn nào tốt hơn.','Review up to 2 fights and the choice to join or trade elsewhere. Record your reasons and available information; KP cannot establish which choice was better.'],
 survivalLimit:['Số lần chết không cho biết nguyên nhân, vị trí đứng hay giá trị đổi mạng.','Death count does not identify causes, positioning or the value of a trade.'],
 farmLimit:['Không áp ngưỡng CS cho Support. Ngưỡng vị trí chỉ là heuristic; CS cuối trận không mô tả quản lý wave.','No CS threshold is applied to Support. Role thresholds are heuristic; end-of-game CS does not describe wave management.'],
 visionLimit:['Điểm tầm nhìn không xác định chất lượng vị trí mắt. Support dùng ngưỡng riêng.','Vision score does not establish ward placement quality. Support uses separate thresholds.'],
 involvementLimit:['KP không đo chất lượng phối hợp; đẩy lẻ hoặc đổi mục tiêu có thể hợp lý.','KP does not measure teamwork quality; split pushing or trading objectives may be reasonable.'],
 heuristic:['Các ngưỡng hiện có là heuristic minh họa, không phải benchmark rank, percentile hoặc điểm kỹ năng.','Existing thresholds are illustrative heuristics, not rank benchmarks, percentiles or skill scores.'],
 causal:['Bảng cuối trận không xác định nguyên nhân thắng/thua, việc nhìn minimap, vị trí đứng hoặc chất lượng quản lý wave.','End-of-game statistics do not establish win/loss causes, minimap attention, positioning or wave management quality.'],
 timeline:['Timeline chưa tải; chưa có replay. Không tạo chỉ số phút 10/15/20 hay diễn giải bộ đồ cuối trận thành thứ tự mua đồ.','No timeline has been loaded and no replay is available. No minute 10/15/20 statistics or item purchase order are inferred from the final inventory.'],
 scope:['Chỉ trận Summoner’s Rift đủ điều kiện trong phạm vi đã lọc được dùng cho coaching và tổng hợp. Remake, trận ngắn, thiếu vị trí hoặc dữ liệu bắt buộc vẫn xem được nhưng bị loại khỏi phân tích.','Only eligible Summoner’s Rift matches within the filtered scope contribute to coaching and aggregation. Remakes, short games and records missing a role or required data remain inspectable but are excluded.'],
 missing:['Dữ liệu thiếu giữ nguyên null. Mỗi chỉ số có số mẫu riêng; tỷ lệ từ tổng khác trung bình tỷ lệ từng trận.','Missing data remains null. Each metric has its own sample size; a pooled ratio differs from the mean of per-match ratios.'],
 unknownRemake:['Remake chưa xác định vẫn được dùng khi các điều kiện coaching khác đạt. Đây là chính sách cho phép có cảnh báo, không phải kết luận trận không remake; gameEndedInEarlySurrender không tương đương isRemake.','Unknown remake status is allowed only when all other coaching criteria pass. This explicit policy does not establish that a game was not a remake; gameEndedInEarlySurrender is not equivalent to isRemake.'],
 projection:['Dữ liệu Riot đã rút gọn không thể khôi phục các trường từng bị bỏ nếu chưa lấy lại nguồn. Các trường chưa thu thập không đồng nghĩa Riot không cung cấp chúng.','Riot projections cannot restore discarded fields without retrieving the source again. Fields that were not collected do not imply Riot omitted them.'],
 rules:['Phân tích theo quy tắc — chưa sử dụng LLM. Dữ liệu chưa được gửi đến nhà cung cấp AI.','Rule-based analysis — no LLM used. Data has not been sent to an AI provider.'],
};

export function labFindingText(key,params={}){
 const pair=Object.hasOwn(messages,key)?messages[key]:[key,key];
 const template=pair[getLanguage()==='en'?1:0];
 return template.replace(/\{(\w+)\}/g,(_,name)=>String(params[name]??`{${name}}`));
}
