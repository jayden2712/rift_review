// "Summarise with AI" for the coaching tab. The facts are the numbers the app already
// computed, pre-formatted; the local server forwards them to the configured model and drops
// anything with numbers that are not in these facts.
import {t, getLocale} from './i18n.js';
import {formatMetric, metricLabel, comparisonTakeaways} from './comparison-view.js';

const escape = value =>
  String(value ?? '').replace(
    /[&<>"']/g,
    char => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'})[char],
  );
const signed = (value, digits) =>
  typeof value === 'number' && Number.isFinite(value)
    ? (value < 0 ? '−' : '+') +
      new Intl.NumberFormat(getLocale(), {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      }).format(Math.abs(value))
    : null;

// Each fact is a full sentence that names whose number it is (you, the lane opponent, wins,
// losses). Small models mix up bare numbers from separate JSON fields; sentences keep the
// context attached to every value.
export function buildAiFacts(report, language) {
  const c = report?.comparison;
  if (!c) return null;
  const lane = (m, count) =>
    t(
      count === 'behind'
        ? '{metric}: bạn {you}, đối thủ cùng đường {opponent}; bạn kém hơn ở {n}/{total} trận.'
        : '{metric}: bạn {you}, đối thủ cùng đường {opponent}; bạn hơn ở {n}/{total} trận.',
      {
        metric: metricLabel(m.id),
        you: formatMetric(m.id, m.you),
        opponent: formatMetric(m.id, m.opponent),
        n: count === 'behind' ? m.behind : m.ahead,
        total: m.total,
      },
    );
  return {
    language,
    games: report.stats.n,
    wins: report.stats.wins,
    takeaways: comparisonTakeaways(c),
    laneBehind: c.lane.metrics.filter(m => m.consistentlyBehind).map(m => lane(m, 'behind')),
    laneAhead: c.lane.metrics.filter(m => m.consistentlyAhead).map(m => lane(m, 'ahead')),
    winsVsLosses: c.winLoss.available
      ? c.winLoss.metrics
          .filter(m => m.notable)
          .map(m =>
            t('{metric}: {win} trong các trận thắng, {loss} trong các trận thua.', {
              metric: metricLabel(m.id),
              win: formatMetric(m.id, m.win),
              loss: formatMetric(m.id, m.loss),
            }),
          )
      : [],
    recentForm: c.self.available
      ? c.self.metrics
          .filter(m => m.notable)
          .map(m =>
            t('{metric}: mức thường của bạn {usual}, 5 trận gần nhất {recent}.', {
              metric: metricLabel(m.id),
              usual: formatMetric(m.id, m.typical),
              recent: formatMetric(m.id, m.recent),
            }),
          )
      : [],
    champions: (report.championComparison ?? []).slice(0, 6).map(row =>
      t(
        '{champion}: {games} trận, thắng {wins}; CS/phút so với đối thủ {cs}; vàng/phút so với đối thủ {gold}.',
        {
          champion: row.champion,
          games: row.games,
          wins: row.wins,
          cs: signed(row.csDiffPerMin, 1) ?? '—',
          gold: signed(row.goldDiffPerMin, 0) ?? '—',
        },
      ),
    ),
  };
}

const ERROR_MESSAGES = {
  AI_UNAVAILABLE: 'Không kết nối được AI. Kiểm tra Ollama đang chạy rồi thử lại.',
  AI_TIMEOUT: 'AI phản hồi quá lâu. Thử lại sau.',
  AI_UPSTREAM: 'Dịch vụ AI trả lỗi. Kiểm tra tên model trong AI_MODEL.',
  AI_BAD_OUTPUT: 'AI trả về nội dung không dùng được. Thử lại.',
  AI_INVALID_FACTS: 'Dữ liệu gửi cho AI không hợp lệ.',
  AI_CONFIG: 'Cấu hình AI_BASE_URL không hợp lệ.',
};

export async function requestAiSummary(facts, {fetchImpl = fetch} = {}) {
  let response;
  try {
    response = await fetchImpl('/api/ai/summary', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({facts}),
      credentials: 'same-origin',
    });
  } catch {
    throw new Error(t('Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại.'));
  }
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    // Handled below with a generic message.
  }
  if (!response.ok || !payload || typeof payload.summary !== 'string' || !Array.isArray(payload.focus)) {
    const code = payload?.error?.code;
    throw new Error(
      t(Object.hasOwn(ERROR_MESSAGES, code) ? ERROR_MESSAGES[code] : 'Chưa thể tạo tóm tắt AI. Thử lại sau.'),
    );
  }
  return payload;
}

// status: {enabled, model, state}; state.kind is idle | loading | error | done.
export function renderAiPanel({enabled, model, state = {kind: 'idle'}}) {
  if (!enabled) return '';
  const button = label =>
    `<button type="button" class="secondary-btn ai-button" data-ai-summary${state.kind === 'loading' ? ' disabled' : ''}>${label}</button>`;
  let body;
  if (state.kind === 'loading')
    body = `<p class="ai-loading" aria-busy="true">${t('AI đang viết tóm tắt từ số liệu ở trên…')}</p>`;
  else if (state.kind === 'error')
    body = `<p class="loss-text">${escape(state.message)}</p>${button(t('Thử lại'))}`;
  else if (state.kind === 'done') {
    const r = state.result;
    body = `${r.summary ? `<p class="ai-text">${escape(r.summary)}</p>` : ''}${
      r.focus.length
        ? `<div class="ai-focus">${r.focus
            .map(
              item =>
                `<article class="ai-focus-card"><h3>${escape(item.title)}</h3><p>${escape(item.why)}</p><p class="ai-drill"><strong>${t('Tập')}</strong> ${escape(item.drill)}</p></article>`,
            )
            .join('')}</div>`
        : ''
    }<p class="small muted ai-note">${t('Do AI ({model}) viết lại từ số liệu ở trên. Chỉ là tương quan, không phải nguyên nhân chắc chắn.', {model: escape(r.model)})}${r.removed ? ' ' + t('Đã bỏ {n} câu có số không khớp với dữ liệu.', {n: r.removed}) : ''}</p>${button(t('Viết lại'))}`;
  } else
    body = `<p class="small muted">${t('Dùng model {model} trên máy bạn để viết lại các điểm trên thành lời khuyên. Chỉ gửi số liệu đã tính, không gửi Riot ID.', {model: escape(model)})}</p>${button(t('Tóm tắt bằng AI'))}`;
  return `<section class="coaching-section ai-panel"><div class="section-heading"><h2>${t('Tóm tắt bằng AI')}</h2><span class="ai-badge">AI</span></div><div class="panel">${body}</div></section>`;
}
