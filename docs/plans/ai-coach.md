# Kế hoạch: AI huấn luyện viên cho Rift Review

Trạng thái: kế hoạch, chưa triển khai. Viết ngày 2026-10-27.

## 0. Mục tiêu và nguyên tắc

**Mục tiêu:** từ dữ liệu trận Summoner's Rift, chỉ ra **hai điểm cần cải thiện**, mỗi điểm có bằng chứng kiểm chứng được và một bài tập cụ thể; nói rõ khi không đủ bằng chứng.

**Nguyên tắc (không đổi qua mọi giai đoạn):**

1. **Code tính số, AI diễn giải.** Mọi con số, so sánh và mốc tham chiếu do code tạo ra; model chỉ chọn và diễn đạt. Bộ lọc số liệu bịa (`server/ai.js`) luôn chạy.
2. **Bằng chứng có địa chỉ.** Mỗi nhận xét trỏ tới mã sự kiện (fact id) cụ thể, không chỉ "có trong dữ liệu".
3. **Được phép nói "không biết".** Lỗi vị trí đứng, quyết định giao tranh không thấy được từ số liệu; model phải từ chối thay vì đoán.
4. **Đo trước, chi tiền sau.** Không thuê GPU khi chưa có bộ đánh giá chứng minh model hiện tại thiếu ở đâu.
5. **Không lưu Riot ID.** Dữ liệu thu thập dùng mã ẩn danh; không công bố dữ liệu gắn với danh tính người chơi.

## 1. Kiến trúc tổng quan

```
VPS (24/7, ~4-6 USD/tháng)          Laptop (RTX 5060 8 GB)              GPU thuê theo giờ (tuỳ chọn)
- collector: Riot API → SQLite      - eval harness (Node)               - QLoRA fine-tune 7-8B
- trích đặc trưng + timeline        - thống kê, LightGBM (Python)       - xuất GGUF → Ollama trên laptop
- backup định kỳ                    - Ollama qwen3:8b / model mới
        └──── rsync file .sqlite ────┘
```

Phần đã có và được tái sử dụng:

- `server/riot.js`: client Riot API có giới hạn tốc độ, retry, xử lý 429.
- `server/data-lab-timeline.js`, `public/data-lab-timeline.js`: tải và chuẩn hoá timeline (`timelineEvidence`, sự kiện `CHAMPION_KILL`, `ITEM_PURCHASED`, `ELITE_MONSTER_KILL`, `BUILDING_KILL`, `TURRET_PLATE_DESTROYED`).
- `public/data-lab-metrics.js`, `public/comparison.js`: chỉ số và so sánh với đối thủ cùng đường, kể cả `challenges`.
- `server/ai.js`: gọi model OpenAI-compatible, JSON schema, bộ lọc số liệu theo đơn vị.

## 2. Giai đoạn 1 — Pipeline dữ liệu trên VPS

### Phạm vi khởi đầu

| Mục | Giá trị |
|---|---|
| Server | OCE (platform `oc1`, routing `sea`) |
| Chế độ | Rank Đơn (queue 420) |
| Vai trò | Mid |
| Rank | Lục Bảo I–IV |
| Patch | Patch hiện tại (lọc theo `gameVersion`) |
| Số trận | ~1.000, có timeline |

### Luồng thu thập

1. `league-v4` entries theo bậc Lục Bảo → danh sách người chơi (PUUID).
2. Mỗi người: `match-v5 ids?queue=420&startTime=<ngày đầu patch>&count=20`.
3. Bỏ trùng mã trận; xếp vào hàng đợi.
4. Mỗi trận: chi tiết trận; nếu người chơi Mid của trận nằm trong bậc rank mục tiêu → tải thêm timeline.
5. Trích đặc trưng cho **cả hai người chơi Mid** (đối xứng: mỗi trận cho 2 mẫu).

### Lưu trữ (SQLite, một file)

| Bảng | Nội dung |
|---|---|
| `players` | `player_key` (HMAC của PUUID với khoá bí mật), tier, division, lần quét cuối |
| `queue` | mã trận, trạng thái (`pending`/`done`/`failed`), số lần thử, lỗi gần nhất |
| `matches` | mã trận, patch, thời lượng, kết quả, JSON chi tiết **đã xoá trường danh tính**, nén gzip |
| `timelines` | mã trận, JSON timeline nén gzip |
| `features` | một dòng mỗi (trận, người chơi Mid): chỉ số cuối trận, chỉ số @10/@15, chênh lệch với đối thủ, sự kiện chết, mốc đồ |
| `runs` | thời điểm chạy, số request, số trận thêm mới, lỗi |

Ước tính dung lượng cho 1.000 trận có timeline: dưới 1 GB khi nén.

### Tốc độ và vận hành

- Key cá nhân: khoảng 100 request / 2 phút / khu vực. 1.000 trận ≈ 1.000 chi tiết + ~1.000 timeline + vài trăm request danh sách ≈ 2.500 request ≈ **khoảng 1 giờ**.
- Tôn trọng `Retry-After` và header giới hạn của Riot; không chạy song song với tra cứu thủ công trên cùng key (giới hạn tính theo key).
- **Dừng lúc nào cũng được:** mỗi bước ghi trạng thái vào `queue`; chạy lại thì tiếp tục từ chỗ dừng.
- Chạy bằng `systemd` (tự khởi động lại), log ra journal. Lệnh: `npm run collect -- --status | --run | --export features.csv`.
- Backup: `sqlite3 .backup` mỗi ngày, `rsync` về laptop.
- Bảo mật: đăng nhập SSH bằng khoá, không mở cổng nào khác; `RIOT_API_KEY` và khoá HMAC nằm trong `.env` trên VPS, không vào git.

### Vị trí code

`tools/collector/` (Node, cùng repo), dùng lại `server/riot.js` và phần chuẩn hoá timeline. Có test với fixture ẩn danh như các phần khác.

### Hoàn thành khi

- 1.000 trận Mid Lục Bảo OCE patch hiện tại có đủ chi tiết + timeline + đặc trưng.
- Dừng giữa chừng rồi chạy lại không mất hay trùng dữ liệu (có test).
- Không có Riot ID trong file SQLite (có test quét).

## 3. Giai đoạn 2 — Bộ đánh giá

### Thành phần

- **60 trận** lấy ngẫu nhiên từ dữ liệu giai đoạn 1: 40 trận "dev" để chỉnh prompt, 20 trận "test" **khoá lại**, chỉ dùng cho quyết định cuối.
- Mỗi trận: bộ **facts** (câu có ngữ cảnh, mỗi câu có `fact_id`) do code sinh từ đặc trưng và timeline.
- Mỗi trận có **nhãn chuẩn** do bạn viết:

```json
{
  "match": "OC1_123",
  "issues": [
    {"category": "early_deaths", "facts": ["f12", "f13"], "drill": "…"},
    {"category": "wave_before_roam", "facts": ["f04"], "drill": "…"}
  ],
  "abstain": ["positioning"],
  "notes": "Đội thua do bot sập; không tính vào Mid."
}
```

### Danh mục vấn đề (cố định, ~10 loại)

| Mã | Ý nghĩa | Bằng chứng cần có |
|---|---|---|
| `lane_cs` | Hụt farm khi đi đường | CS @10/@15, chênh lệch với đối thủ |
| `lane_trade` | Thua giao tranh đường | Vàng/kinh nghiệm @10, hạ gục/chết trước 14 phút |
| `early_deaths` | Chết sớm | Sự kiện chết trước 14 phút, ai hạ gục |
| `death_before_objective` | Chết ngay trước rồng/Baron | Chết trong 60 giây trước sự kiện objective |
| `wave_before_roam` | Rời đường bỏ wave | CS giảm quanh thời điểm tham gia hạ gục ở đường khác |
| `vision_setup` | Thiếu chuẩn bị tầm nhìn | Mắt kiểm soát, mắt phá, objective |
| `objective_presence` | Vắng mặt ở objective | Tham gia rồng/Sứ giả/Baron |
| `item_timing` | Lên đồ chậm | Phút hoàn thành món chính so với mốc |
| `kp_low` | Ít tham gia giao tranh | KP so với đối thủ |
| `insufficient` | Không đủ bằng chứng | — |

Không có trong danh mục (vị trí đứng, quyết định combat) thì nhãn chuẩn phải là `abstain`.

### Chỉ số chấm

| Chỉ số | Cách đo | Tự động? |
|---|---|---|
| **Bằng chứng đúng** | Mọi `fact_id` model trích có tồn tại và mọi số khớp đúng fact đó (mở rộng bộ lọc hiện tại từ "số có trong dữ liệu" thành "số thuộc đúng fact được trích") | Có |
| **Trùng vấn đề** | Số vấn đề model chọn trùng nhãn chuẩn: 0, 1 hoặc 2 | Có |
| **Từ chối đúng** | Khi nhãn chuẩn có `abstain`, model có từ chối hay bịa | Có |
| **Hữu ích** | Bạn chấm 1–5, **mù** (không biết model nào) | Không |
| **Hợp lệ** | Đúng JSON schema, không bị bộ lọc bỏ toàn bộ | Có |
| **Tốc độ** | Giây mỗi trận trên laptop | Có |

Mỗi cấu hình chạy 3 lần (nhiệt độ cố định) để đo độ ổn định.

### Công cụ

- `npm run eval -- --model qwen3:8b --set dev` → báo cáo JSON + Markdown trong `.local/eval/`.
- Gán nhãn: file JSONL sửa tay trước; nếu chậm thì làm một trang local nhỏ hiển thị facts và các ô chọn danh mục.
- Công sức ước tính: 60 trận × 10–15 phút = **10–15 giờ** viết nhãn. Đây là phần tốn nhất của giai đoạn 2.

### Hoàn thành khi

- 60 trận có nhãn; bộ test khoá lại.
- Chạy được baseline (quy tắc hiện tại + `qwen3:8b`) và có số liệu cho mọi chỉ số tự động.

## 4. Giai đoạn 3 — Thống kê và mốc so sánh theo rank

Cần nhiều dữ liệu hơn giai đoạn 1: mở rộng collector lên **20.000–50.000 trận** Mid Lục Bảo OCE (khoảng 15–30 giờ chạy trên VPS, có thể kéo dài nhiều ngày).

- **Mốc so sánh**: trung vị và khoảng tứ phân vị của CS/vàng/kinh nghiệm @10/@15, số lần chết trước 14 phút, mốc món chính, theo vai trò và theo tướng (chỉ tướng đủ mẫu, ví dụ ≥ 200 lượt).
- **Yếu tố đầu trận**: LightGBM dự đoán thắng/thua **chỉ từ đặc trưng tới phút 15**, để tránh rò rỉ kết quả từ chỉ số cuối trận; đọc mức quan trọng của đặc trưng như tương quan, không phải nhân quả.
- **Đưa vào app**: mốc so sánh thành facts mới ("CS @10 của bạn 68, trung vị Mid Lục Bảo 74"); thay dần các ngưỡng "demo" trong `public/coach.js`.

Hoàn thành khi: có file mốc so sánh theo patch, dùng được trong coaching và trong facts gửi AI, có test.

## 5. Giai đoạn 4 — Đánh giá model sẵn có

So trên bộ **dev**, rồi xác nhận trên bộ **test**:

| Cấu hình | Ghi chú |
|---|---|
| Baseline: quy tắc + `qwen3:8b`, facts hiện tại | Mốc hiện trạng |
| `qwen3:8b` + facts có mốc so sánh (giai đoạn 3) + fact id | Kỳ vọng tăng "trùng vấn đề" |
| Như trên, bật chế độ suy nghĩ | Đổi tốc độ lấy chất lượng |
| Một model cloud mạnh (tuỳ chọn) | Chỉ để biết trần chất lượng; chỉ gửi facts ẩn danh |

**Cổng quyết định:**

- Nếu "bằng chứng đúng" < 95% → sửa facts và bộ kiểm tra, **không** fine-tune.
- Nếu bằng chứng tốt nhưng "trùng vấn đề" thấp và model cloud cao hơn rõ → có lý do để fine-tune.
- Nếu model sẵn có đã đạt mục tiêu → dừng ở đây, không cần giai đoạn 5.

## 6. Giai đoạn 5 — Fine-tune (tuỳ chọn, có cổng)

Chỉ làm khi giai đoạn 4 cho thấy khoảng cách nằm ở **cách chọn và diễn đạt vấn đề**, không phải ở dữ liệu.

- **Dữ liệu**: 300–1.000 cặp (facts → nhận xét chuẩn) theo đúng danh mục; có thể dùng model mạnh viết nháp rồi bạn duyệt. **Kiểm tra điều khoản** của nhà cung cấp về việc dùng câu trả lời để train model khác, và giấy phép của model gốc (Qwen) về fine-tune và phân phối.
- **Cách làm**: QLoRA trên model 7–8B, thuê GPU ~24 GB theo giờ; vài giờ cho mỗi lần train.
- **Triển khai**: hợp nhất adapter, xuất GGUF, nạp vào Ollama trên laptop; đổi `AI_MODEL`.
- **Chỉ thay model khi** thắng baseline trên bộ **test** ở "trùng vấn đề" và "hữu ích", không thua ở "bằng chứng đúng" và "từ chối đúng". Giữ model cũ để quay lại.

## 7. Kho tra cứu theo patch

Kiến thức đổi mỗi patch không nằm trong model mà nằm trong kho tra cứu, chèn vào facts khi cần:

- Dữ liệu tướng, đồ, augment: đã có script đồng bộ từ CommunityDragon (`scripts/sync-*.py`), khoá theo phiên bản.
- Mốc so sánh theo patch: từ giai đoạn 3.
- Ghi chú meta do bạn tự viết (ngắn, có ngày, có nguồn), không lấy tự động từ trang thứ ba.

## 8. Chi phí và thời gian ước tính

| Hạng mục | Ước tính |
|---|---|
| VPS | ~4–6 USD/tháng (kiểm tra giá hiện tại) |
| Giai đoạn 1 (code collector) | 2–4 buổi làm việc |
| Giai đoạn 2 (harness + 60 nhãn) | 1–2 buổi code + 10–15 giờ gán nhãn |
| Giai đoạn 3 (thu thêm + thống kê) | 15–30 giờ máy chạy + 2–3 buổi phân tích |
| Giai đoạn 5 (nếu cần) | GPU vài giờ × giá thuê theo giờ; công sức chính là tạo 300–1.000 ví dụ |

Chi phí lớn nhất là **thời gian gán nhãn**, không phải tiền máy.

## 9. Rủi ro và cách giảm

| Rủi ro | Cách giảm |
|---|---|
| Coaching từng trận nhiễu | Bắt buộc dùng timeline; cho phép `abstain`; về sau bổ sung đánh giá theo cửa sổ 10 trận |
| Rò rỉ kết quả trong model thống kê | Chỉ dùng đặc trưng tới phút 15 |
| Patch đổi làm sai mốc | Lưu `gameVersion`; tính lại mốc mỗi patch |
| Lệch mẫu theo rank/server | Báo cáo rõ phạm vi; mở rộng dần |
| Nhãn chuẩn thiếu nhất quán | Danh mục cố định, hướng dẫn gán nhãn, gán lại 10 trận sau một tuần để đo độ nhất quán |
| Riot đổi API hoặc giới hạn | Collector đọc header giới hạn; dừng và báo lỗi thay vì thử dồn dập |
| Key bị lộ trên VPS | Chỉ đăng nhập bằng khoá SSH, `.env` quyền 600, xoay key nếu nghi lộ |

## 10. Chính sách và quyền riêng tư

- Đối chiếu Riot Developer Policies về lưu trữ, sử dụng dữ liệu và loại key (personal/production), nhất là trước khi publish.
- Không lưu Riot ID; PUUID chỉ lưu dạng HMAC; xoá trường danh tính khỏi JSON thô.
- Không chia sẻ hay bán bộ dữ liệu; không công bố thống kê gắn với người chơi cụ thể.

## 11. Việc cần làm đầu tiên (sprint 1)

1. Thuê VPS Ubuntu, cài Node 20, cấu hình SSH và tường lửa.
2. Viết `tools/collector/` với SQLite, hàng đợi dừng/tiếp tục, test bằng fixture ẩn danh.
3. Chạy thử trên laptop với 50 trận; kiểm tra không có Riot ID, kiểm tra dừng giữa chừng.
4. Chuyển lên VPS, chạy tới 1.000 trận có timeline.
5. Viết bộ sinh facts có `fact_id` từ đặc trưng và timeline.
6. Chọn ngẫu nhiên 60 trận, gán nhãn 10 trận đầu để thử danh mục, chỉnh danh mục rồi gán tiếp.
7. Viết `npm run eval`, chạy baseline, ghi kết quả vào `.local/eval/`.
