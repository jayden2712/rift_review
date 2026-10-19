# Data Lab — kiểm tra dữ liệu local

Data Lab dành cho kiểm tra dữ liệu Summoner’s Rift và bằng chứng của bộ luật coaching, **chưa sử dụng LLM**. Tính năng mặc định tắt. Chạy:

```bash
DATA_LAB_ENABLED=1 npm start
```

Hoặc thêm `DATA_LAB_ENABLED=1` vào `.env` rồi khởi động lại server. Mở http://localhost:4173 và chọn **Data Lab** trên thanh điều hướng. Chỉ giá trị `1` bật tính năng. Server vẫn chỉ nghe loopback và kiểm tra Host/Origin; hosted Worker không có API hay assets Data Lab, kể cả khi cấu hình cùng biến môi trường. Đặt `0` hoặc bỏ biến rồi khởi động lại để tắt.

1. Chọn **10/20 trận**, nhập Riot ID/server rồi **Tra cứu Riot & lưu**. Cần Riot key hợp lệ ở backend. Data Lab lấy trang lịch sử mới nhất không lọc queue; các trận ngoài SR vẫn xem được nhưng bị loại khỏi coaching với lý do cụ thể. Lỗi Riot hoặc thiếu chi tiết trận không tạo Demo thay thế.
2. Không có key: chọn **Dùng Demo SR**, **Dùng lịch sử đang xem**, hoặc nhập History JSON/snapshot. Lịch sử đang xem lấy tối đa 10/20 trận đầu; import nhận tối đa 20 trận, giới hạn **8 MiB**. Dữ liệu mẫu có nhãn Demo; dữ liệu nhập/lịch sử đang xem không được coi là Riot đã xác minh. Những thao tác này chưa tự lưu xuống đĩa.
3. Trong tab **Dữ liệu**, lọc vị trí/tướng/queue/kết quả, chọn giới hạn nhóm và bấm tiêu đề cột để sắp xếp. Bấm tướng để mở dữ liệu trận, participant, trang bị, trường còn thiếu và công thức chỉ số. Nhóm phân tích được cố định sau lọc và chọn N trận mới nhất theo thời gian; sắp xếp cột chỉ đổi thứ tự hiển thị. Trận thiếu thời gian xếp sau các trận có thời gian và theo match ID ổn định, không tự tạo ngày giờ; giao diện ghi rõ giới hạn này. Trận bị loại vẫn có thể kiểm tra.
4. Tab **Coaching / Bằng chứng** tách số liệu quan sát, giả thuyết và đề xuất. Liên kết bằng chứng mở đúng trận. Ngưỡng là luật thử nghiệm hiện có, không phải chuẩn rank/patch hoặc kết luận về nguyên nhân.
5. **Lưu snapshot** tạo bản JSON local; **Mở bản lưu** khôi phục bản đã chọn. **Xuất snapshot JSON** giữ riêng dữ liệu nguồn, dữ liệu chuẩn hóa, chỉ số và trạng thái dữ liệu. **Xuất Coaching input JSON** xuất schema v2 gồm phạm vi, trận, công thức/tử số/mẫu số, bằng chứng, giới hạn và `engine.llmUsed: false` trực tiếp từ lớp dữ liệu; không đọc HTML hoặc gửi đến nhà cung cấp AI.

### Snapshot cũ và bổ sung dữ liệu nguồn

Schema **v3** đọc được snapshot Data Lab **v1/v2** và bổ sung timeline; snapshot cũ không có timeline được hiểu là chưa thu thập. Mở bằng **Nhập History JSON hoặc snapshot**, hoặc chọn bản trên máy rồi **Mở bản lưu**. Migration tính lại trạng thái và chỉ số, nhưng giữ provenance: `projection: true` vẫn là **Dữ liệu nguồn đã rút gọn**. Những trường đã bị bỏ không thể khôi phục từ normalized data. Import một bản có nguồn Riot không xác minh lại nguồn đó; trạng thái nhập và dạng dữ liệu nguồn được thể hiện riêng.

Để lấy lại nguồn cho một trận đã rút gọn, mở chi tiết trận rồi chọn **Bổ sung dữ liệu từ Riot**. Backend dùng match ID, routing và định danh người chơi để lấy riêng match detail qua Riot client/cache/rate limiter hiện có. Nếu thành công, nó giữ toàn bộ JSON body, chạy lại normalization, metrics, trạng thái dữ liệu và bằng chứng; lưu snapshot mới bằng UUID mới. File snapshot cũ không bị ghi đè. Nếu thất bại, dữ liệu đang xem được giữ nguyên và lỗi được hiển thị; HTTP 403 biểu thị bị từ chối quyền truy cập, không mặc định key hết hạn. Trận thiếu ID/routing/định danh phù hợp cần lấy lại qua tra cứu Riot. Không tự tải lại hàng loạt khi mở Data Lab; rank/mastery không được gọi. Timeline chỉ tải riêng khi người dùng bấm nút của một trận.

Snapshot nằm tại `.local/data-lab/<UUID>.json`, được Git bỏ qua, tối đa **100 bản**, mỗi bản tối đa **8 MiB**. Đây là bộ lưu trên máy, tách khỏi localStorage lịch sử Mayhem; không tự đồng bộ cloud hoặc xóa bản cũ. Khi đầy, xuất/sao lưu rồi tự dọn file không cần. API không nhận đường dẫn lưu từ trình duyệt. Import/lưu qua trình duyệt không tự trở thành nguồn Riot đã xác minh; Demo vẫn có nhãn Demo.

### Trạng thái dữ liệu và remake

Giao diện tách **thống kê cơ bản**, **thống kê bổ sung**, **dạng dữ liệu nguồn**, **remake**, **timeline** và **điều kiện coaching**. Thiếu `isRemake` không làm thống kê cơ bản đầy đủ bị gắn nhãn thiếu. Chi tiết trận liệt kê trường thiếu, ảnh hưởng đến chỉ số và phân biệt chưa thu thập, không có trong nguồn, giá trị không hợp lệ. Giá trị thiếu giữ `null`; số 0 hợp lệ vẫn là 0.

`gameEndedInEarlySurrender` không được coi là `isRemake`. Khi không có bằng chứng trực tiếp, remake giữ **chưa xác định**; cờ remake rõ ràng trong dữ liệu nhập được giữ lại. Chính sách coaching vẫn cho phép trận remake chưa xác định nếu các điều kiện SR khác đạt, đồng thời ghi rõ giới hạn này; remake đã xác định, trận dưới 5 phút/trên 90 phút, ngoài SR hoặc thiếu trường bắt buộc bị loại với lý do cụ thể. Quy tắc thời lượng là điều kiện phân tích, không phải suy luận remake.

Riêng **Dùng lịch sử đang xem** từ Riot: mapper lịch sử hiện tại `mapRiotMatch()` trong `server/riot.js` đã gán `isRemake: false` cho SR sau khi lọc thời lượng. Đây không phải cờ remake do Riot xác nhận. Data Lab bỏ suy luận này trong normalized data của nguồn `riot_projection`, đưa remake về `null`/unknown với basis `unsupported_projection_inference`, nhưng giữ nguyên giá trị trong raw. Quy tắc cũng áp dụng khi mở/xuất lại snapshot đó; không sửa hành vi lịch sử thông thường hoặc cờ remake rõ ràng của dữ liệu nhập thủ công.

[Riot MATCH-V5](https://developer.riotgames.com/apis#match-v5) không tài liệu hóa trường `isRemake`; mô tả `gameEndedInEarlySurrender` hiện có nội dung không liên quan nên không dùng làm căn cứ suy luận. [Riot Remake FAQ](https://support.riotgames.com/en-us/league-of-legends/gameplay/remake-faq) và [patch 12.22](https://www.leagueoflegends.com/en-sg/news/game-updates/patch-12-22-notes/) phân biệt remake với early surrender. Không hardcode thời gian remake theo hướng dẫn gameplay để kết luận từ bảng cuối trận.

Timeline là endpoint MATCH-V5 riêng, chỉ được tải theo yêu cầu từng trận SR. Có nguyên bản match detail không đồng nghĩa đã thu thập timeline. Thống kê nhóm chỉ dùng trận SR đủ điều kiện và mỗi chỉ số có số mẫu riêng. KDA *pooled* = tổng(kills + assists) / tổng(deaths), bao gồm trận không chết khi đủ K/A/D; ví dụ 10/0/0 và 0/5/5 cho KDA tổng bằng 3. KDA *mean* chỉ lấy các tỷ lệ từng trận có deaths > 0 và báo số mẫu riêng; trận không chết không được thay bằng 0 hoặc Infinity. Tổng deaths = 0 có trạng thái riêng, thiếu dữ liệu giữ null. Damage/gold share yêu cầu đủ dữ liệu đội; không suy luận nguyên nhân từ thống kê cuối trận.

### Thu thập từng phần và timeline SR

Tra cứu giữ lại các match detail tải thành công khi một trận không có sẵn. Báo cáo theo match ID phân biệt số trận yêu cầu, đã thử, thành công, thất bại và chưa thực hiện, cùng số trận đủ điều kiện coaching. Lỗi xác thực/quyền truy cập (401/403) hoặc rate limit dừng chuỗi yêu cầu tiếp theo; 403 không được mặc định là key hết hạn. Có thể chủ động thử lại các ID phù hợp. Nếu không có trận nào thành công, API trả lỗi rõ ràng, không tạo Demo và không ghi đè snapshot cũ.

Mở chi tiết một trận SR trong bảng Data Lab rồi bấm **Tải timeline**. Mỗi thao tác gọi `POST /api/lab/timeline` cho đúng một match ID đã có trong snapshot; backend dùng Riot client, regional routing, timeout, cache và rate limiter sẵn có để gọi `GET /lol/match/v5/matches/{matchId}/timeline`. Danh tính được kiểm tra bằng match ID và participant ID/PUUID; vị trí trong mảng không được dùng để suy ra người chơi. Không tự tải timeline khi mở snapshot hoặc xem lịch sử.

Số đếm thu thập áp dụng cho thao tác gần nhất, còn danh sách lỗi/chưa thực hiện giữ các ID còn tồn đọng. Nút thử lại bao gồm các trận chưa được yêu cầu sau khi chuỗi bị dừng; lỗi 401/403 cần sửa cấu hình rồi tra cứu lại.

Các trạng thái timeline: `not_loaded` (chưa thu thập), `loading` (đang tải), `loaded` (đã tải), `unavailable` (Riot không có dữ liệu) và `error` (thao tác lỗi). Lưu thời điểm tải, lần thử và mã lỗi gần nhất. Tải lại lỗi giữ nguyên raw timeline hợp lệ trước đó; người dùng vẫn xem được bản đã tải. Bản lưu thành công có UUID mới, không ghi đè file cũ. Có thể xem raw JSON, lọc sự kiện của người chơi, xem đồ thị CS/vàng và xuất/nhập cùng snapshot.

Mỗi record tách `timeline.raw` (toàn bộ JSON body), `timeline.normalized` (frames/checkpoints/events) và bằng chứng suy ra. Import tính lại lớp chuẩn hóa và không tự biến dữ liệu nhập thành Riot đã xác minh. Giữ giới hạn **8 MiB cho toàn bộ snapshot**, tối đa **2 MiB cho mỗi raw timeline**. Nếu thêm timeline làm vượt giới hạn, thao tác báo lỗi và giữ dữ liệu cũ; không cắt raw hoặc tăng giới hạn ngầm. Đồ thị nối liên tục các mẫu có giá trị theo timestamp thực tế, kể cả khi khoảng giữa hai mẫu vượt 60 giây; chỉ ngắt ở giá trị thiếu. Đường nối phục vụ hiển thị, không tạo thêm số đo hoặc thay đổi chính sách chọn mốc. Muốn thu thập nhiều timeline lớn, lưu các nhóm trận nhỏ hơn. HTTP headers/API key không nằm trong raw, UI hoặc file xuất.

Mốc 10/15/20 phút dùng frame gần nhất **tại hoặc trước** mốc, tối đa lệch **60.000 ms**. Kết quả chứa `targetTimestamp`, `actualTimestamp`, `offsetMs` và lý do khi không đo được. Trận kết thúc trước mốc hoặc không có frame trong cửa sổ cho giá trị null. Không dùng index frame làm phút, không nội suy và không lấy bảng cuối trận thay cho timeline. CS = `minionsKilled + jungleMinionsKilled` chỉ khi cả hai có giá trị; thiếu field giữ null, số 0 hợp lệ giữ nguyên. Các sự kiện cùng timestamp được giữ riêng bằng vị trí nguồn.

Bằng chứng timeline chỉ mô tả chênh lệch CS/vàng giữa hai frame và thời điểm người chơi chết. Mỗi quan sát có ID ổn định, match/participant ID, timestamp hoặc khoảng thời gian, đường dẫn field nguồn, công thức và giới hạn. Coaching input JSON chứa bằng chứng/checkpoints gọn và tham chiếu nguồn, không kèm toàn bộ raw timeline. Không suy ra quản lý wave, quan sát minimap, vị trí sai hoặc nguyên nhân thắng/thua từ các số này; chưa tích hợp LLM hoặc coaching Mayhem.

Schema đối chiếu ngày **2026-10-05** với [Riot MATCH-V5](https://developer.riotgames.com/api-details/match-v5): `TimelineDto`, `InfoTimeLineDto`, `ParticipantTimeLineDto`, `FramesTimeLineDto`, `ParticipantFrameDto`. Tài liệu event chỉ công bố các field cơ bản; các nhánh kill/item/objective được kiểm tra bằng fixture tổng hợp, giữ nguyên mọi field chưa dùng trong raw. **Kiểm thử hiện tại dùng fixture, chưa xác minh Riot live**. Không cam kết timeline luôn có sẵn cho mọi trận.

### Vì sao v1 thiếu trường và cách v2 giữ raw

Trong v1, `public/data-lab-model.js` dùng `rawRiot()`/`rawProjection()` để chỉ giữ các trường cho phép, nên `teams`, perks, summoner spells và trường ngoài danh sách bị bỏ. `fromRiot()` đặt `isRemake: null`; `record()` đưa nó vào `completeness.missingFields` và gộp thành `status: partial`. `renderLabRows()` trong `public/data-lab-view.js` chuyển trạng thái đó thành nhãn chung **Thiếu dữ liệu**, dù các chỉ số cơ bản đã có đủ.

V2 giữ toàn bộ **JSON body match detail** trước normalization, bao gồm trường chưa dùng hoặc chưa biết trước, trong lớp raw riêng. Normalization không sửa raw. Phản hồi Riot nguyên bản, projection cũ, dữ liệu nhập và Demo được phân biệt; không tái tạo raw nguyên bản từ normalized data. JSON được kiểm tra để từ chối credentials/request headers trước khi lưu/xuất thay vì âm thầm xóa trường rồi gọi đó là nguyên bản. API key chỉ ở backend/environment; raw là JSON body, không bao gồm HTTP request/response headers.

`createRiotClient().get()` trong `server/riot.js` đã nhận và cache toàn bộ JSON body trước projection. Cache bộ nhớ local tối đa **128 entry**, **524.288 code unit của chuỗi JSON mỗi entry**, TTL tối đa **24 giờ**; Data Lab và lịch sử có cache riêng. Cache không phải kho phục hồi bền vững: restart, hết hạn hoặc eviction có thể làm mất bản gốc. Snapshot v1 chỉ khôi phục trường đã bỏ khi người dùng chủ động bổ sung lại từ Riot; không hứa rằng cache vẫn còn.

Kiểm tra backend/model và build bằng `npm test` cùng `npm run build`. E2E tùy chọn dùng fixture tổng hợp và thư mục tạm, không cần key; với Playwright được cài riêng:

```bash
PLAYWRIGHT_MODULE=/tmp/rift-mayhem-browser/node_modules/playwright/index.mjs \
PLAYWRIGHT_BROWSERS_PATH=/tmp/rift-mayhem-browser/browsers \
node tests/e2e/data-lab.mjs

PLAYWRIGHT_MODULE=/tmp/rift-mayhem-browser/node_modules/playwright/index.mjs \
PLAYWRIGHT_BROWSERS_PATH=/tmp/rift-mayhem-browser/browsers \
node tests/e2e/data-lab-enrich.mjs

PLAYWRIGHT_MODULE=/tmp/rift-mayhem-browser/node_modules/playwright/index.mjs \
PLAYWRIGHT_BROWSERS_PATH=/tmp/rift-mayhem-browser/browsers \
node tests/e2e/data-lab-timeline.mjs
```

Thay hai đường dẫn bằng bản Playwright/Chromium có trên máy. `data-lab-enrich.mjs` dùng fixture kiểm tra lỗi 403 giữ dữ liệu cũ, sau đó bổ sung thành công giữ trường raw bổ sung và tạo UUID mới. Luồng kiểm thử fixture không xác minh Riot live.
