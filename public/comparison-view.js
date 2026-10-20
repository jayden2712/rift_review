import {t, getLocale} from './i18n.js';
import {championAvatar} from './champion-icons.js';

const escape = value =>
  String(value ?? '').replace(
    /[&<>"']/g,
    char => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'})[char],
  );
const LABELS = {
  deathsPer30: 'Chết / 30 phút',
  csPerMin: 'CS / phút',
  goldPerMin: 'Vàng / phút',
  damagePerMin: 'Sát thương / phút',
  damageShare: '% sát thương của đội',
  kp: 'Tham gia hạ gục',
  visionPerMin: 'Tầm nhìn / phút',
  timeDeadShare: '% thời gian chết',
  csAt10: 'Lính 10 phút đầu',
  jungleCsAt10: 'CS rừng 10 phút đầu',
  soloKills: 'Hạ gục solo',
  plates: 'Mảnh giáp trụ',
  objectives: 'Rồng · Sứ giả · Baron',
  enemyJungleCamps: 'Quái rừng đối phương',
  controlWardsPer30: 'Mắt kiểm soát / 30 phút',
  wardKillsPer30: 'Mắt phá / 30 phút',
};
export const metricLabel = id => t(LABELS[id]);
const label = metricLabel;
const PERCENT = new Set(['damageShare', 'kp', 'timeDeadShare']);
const WHOLE = new Set(['goldPerMin', 'damagePerMin', 'csAt10']);
export function formatMetric(id, value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  if (PERCENT.has(id)) return Math.round(value * 100) + '%';
  const digits = WHOLE.has(id) ? 0 : 1;
  return new Intl.NumberFormat(getLocale(), {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

export function comparisonTakeaways(c) {
  const lines = [];
  const behind = c.lane.metrics.filter(m => m.consistentlyBehind);
  for (const m of behind.slice(0, 2))
    lines.push(
      t('Bạn kém đối thủ cùng đường về {metric} ở {behind}/{total} trận ({you} so với {opponent}).', {
        metric: label(m.id),
        behind: m.behind,
        total: m.total,
        you: formatMetric(m.id, m.you),
        opponent: formatMetric(m.id, m.opponent),
      }),
    );
  const split = c.winLoss.available ? c.winLoss.metrics.find(m => m.notable) : null;
  if (split)
    lines.push(
      t('Khác biệt lớn nhất giữa trận thắng và trận thua: {metric} ({win} khi thắng, {loss} khi thua).', {
        metric: label(split.id),
        win: formatMetric(split.id, split.win),
        loss: formatMetric(split.id, split.loss),
      }),
    );
  const slip = c.self.available ? c.self.metrics.find(m => m.notable && !m.better) : null;
  if (slip)
    lines.push(
      t('5 trận gần nhất, {metric} kém hơn mức thường của bạn ({typical} → {recent}).', {
        metric: label(slip.id),
        typical: formatMetric(slip.id, slip.typical),
        recent: formatMetric(slip.id, slip.recent),
      }),
    );
  return lines.slice(0, 3);
}

function laneCard(lane) {
  const rows = lane.metrics.filter(m => m.total > 0);
  const body = rows.length
    ? `<table class="compare-table"><thead><tr><th>${t('Chỉ số')}</th><th>${t('Bạn')}</th><th>${t('Đối thủ')}</th><th>${t('Số trận hơn')}</th></tr></thead><tbody>${rows
        .map(
          m =>
            `<tr class="${m.consistentlyBehind ? 'is-behind' : m.consistentlyAhead ? 'is-ahead' : ''}"><th scope="row">${label(m.id)}</th><td>${formatMetric(m.id, m.you)}</td><td>${formatMetric(m.id, m.opponent)}</td><td><span class="compare-count">${t('Hơn ở {ahead}/{total} trận', {ahead: m.ahead, total: m.total})}</span><meter min="0" max="${m.total}" value="${m.ahead}" aria-hidden="true"></meter></td></tr>`,
        )
        .join('')}</tbody></table>`
    : `<p class="small muted">${t('Cần dữ liệu chi tiết có vị trí của cả hai đội. Tra cứu bằng Riot ID để có so sánh này.')}</p>`;
  return `<article class="compare-card"><h3>${t('So với đối thủ cùng đường')}</h3><p class="small muted">${t('Người cùng vị trí ở đội bên kia, trong cùng trận và cùng thời lượng.')}</p>${body}</article>`;
}

function winLossCard(winLoss) {
  const body = winLoss.available
    ? `<p class="small muted">${t('{wins} thắng · {losses} thua', {wins: winLoss.wins, losses: winLoss.losses})}</p><ul class="compare-list">${winLoss.metrics
        .map(
          m =>
            `<li class="${m.notable ? 'is-notable' : ''}"><span>${label(m.id)}</span><span><strong class="win-text">${formatMetric(m.id, m.win)}</strong> <span class="muted">${t('khi thắng')}</span> · <strong class="loss-text">${formatMetric(m.id, m.loss)}</strong> <span class="muted">${t('khi thua')}</span></span></li>`,
        )
        .join('')}</ul>`
    : `<p class="small muted">${t('Cần ít nhất 3 trận thắng và 3 trận thua trong bộ lọc (hiện có {wins} thắng, {losses} thua).', {wins: winLoss.wins, losses: winLoss.losses})}</p>`;
  return `<article class="compare-card"><h3>${t('Thắng và thua khác nhau ở đâu')}</h3>${body}<p class="small muted compare-note">${t('Chỉ là tương quan: thua trận cũng có thể khiến chỉ số xấu đi.')}</p></article>`;
}

function selfCard(self) {
  const verdict = m =>
    !m.notable
      ? `<span class="trend-change">${t('Gần như không đổi')}</span>`
      : `<span class="trend-change ${m.better ? 'win-text' : 'loss-text'}">${m.better ? t('Tốt hơn') : t('Kém hơn')}</span>`;
  const body = self.available
    ? `<p class="small muted">${t('Vị trí {role}: {recent} trận gần nhất so với trung vị {baseline} trận trước đó.', {role: escape(t(self.role)), recent: self.recentN, baseline: self.baselineN})}</p><ul class="compare-list">${self.metrics
        .map(
          m =>
            `<li class="${m.notable ? 'is-notable' : ''}"><span>${label(m.id)}</span><span>${formatMetric(m.id, m.typical)} <span class="trend-arrow">→</span> <strong>${formatMetric(m.id, m.recent)}</strong> ${verdict(m)}</span></li>`,
        )
        .join('')}</ul>`
    : `<p class="small muted">${t('Cần ít nhất 10 trận cùng vị trí chính có dữ liệu chi tiết.')}</p>`;
  return `<article class="compare-card"><h3>${t('So với chính bạn')}</h3>${body}</article>`;
}

export function renderComparison(c) {
  const takeaways = comparisonTakeaways(c);
  const lead = takeaways.length
    ? `<ul class="compare-takeaways">${takeaways.map(line => `<li>${escape(line)}</li>`).join('')}</ul>`
    : `<p class="small muted">${t('Chưa có khác biệt đủ rõ để rút ra điều cần tập.')}</p>`;
  return `<section class="coaching-section compare-section"><div class="section-heading"><h2>${t('So sánh để tìm điều cần tập')}</h2><span>${t('{known}/{total} trận có dữ liệu chi tiết', {known: c.coverage.withDetail, total: c.coverage.total})}</span></div><div class="panel compare-lead"><span class="eyebrow">${t('ĐIỂM RÚT RA')}</span>${lead}</div><div class="compare-grid">${laneCard(c.lane)}${winLossCard(c.winLoss)}${selfCard(c.self)}</div></section>`;
}

function signed(value, digits = 1) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '<span class="muted">—</span>';
  const text = new Intl.NumberFormat(getLocale(), {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(Math.abs(value));
  if (Math.abs(value) < 10 ** -digits / 2) return `<span class="muted">${text}</span>`;
  return `<span class="${value > 0 ? 'win-text' : 'loss-text'}">${value > 0 ? '+' : '−'}${text}</span>`;
}

export function renderChampionBreakdown(rows) {
  const body = rows.length
    ? `<div class="table-scroll"><table class="compare-table champion-table"><thead><tr><th>${t('Tướng')}</th><th>${t('Trận')}</th><th>${t('Tỉ lệ thắng')}</th><th>KDA</th><th>${t('Chết / 30 phút')}</th><th>${t('CS / phút')}</th><th>${t('CS / phút so với đối thủ')}</th><th>${t('Vàng / phút so với đối thủ')}</th></tr></thead><tbody>${rows
        .map(
          row =>
            `<tr><th scope="row"><span class="champion-cell">${championAvatar(row.champion, true)}<span>${escape(row.champion)}</span></span></th><td>${row.games}</td><td class="${row.wins / row.games >= 0.5 ? 'win-text' : 'loss-text'}">${Math.round((row.wins / row.games) * 100)}%</td><td>${formatMetric('kda', row.kda)}</td><td>${formatMetric('deathsPer30', row.deathsPer30)}</td><td>${formatMetric('csPerMin', row.csPerMin)}</td><td>${signed(row.csDiffPerMin)}</td><td>${signed(row.goldDiffPerMin, 0)}</td></tr>`,
        )
        .join('')}</tbody></table></div>`
    : `<p class="small muted">${t('Cần ít nhất 3 trận với một tướng trong bộ lọc.')}</p>`;
  return `<section class="coaching-section"><div class="section-heading"><h2>${t('Theo tướng')}</h2><span>${t('Tướng có từ 3 trận · so với đối thủ cùng đường')}</span></div><div class="panel">${body}</div></section>`;
}
