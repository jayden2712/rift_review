import {t, getLocale} from './i18n.js';

export const CHART_METRICS = [
  {id: 'cs', label: 'CS / phút', field: 'cs'},
  {id: 'kda', label: 'KDA'},
  {id: 'kp', label: 'Tham gia hạ gục (%)'},
  {id: 'damage', label: 'Sát thương / phút', field: 'damageToChampions'},
  {id: 'gold', label: 'Vàng / phút', field: 'goldEarned'},
  {id: 'deaths', label: 'Chết / 30 phút', field: 'deaths', scale: 30},
  {id: 'vision', label: 'Vision / phút', field: 'visionScore', srOnly: true},
];
const escape = value =>
  String(value ?? '').replace(
    /[&<>"']/g,
    char => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'})[char],
  );
export const chartMetrics = mode => CHART_METRICS.filter(metric => mode !== 'mayhem' || !metric.srOnly);

// Receives the report's selected cohort, not the paginated match list.
// Reverse its newest-first order; missing dates preserve the input order contract.
export function buildChartData(report, selectedMetric) {
  const options = chartMetrics(report.mode);
  const metric =
    options.find(option => option.id === selectedMetric) ||
    options.find(option => option.id === (report.mode === 'mayhem' ? 'damage' : 'cs'));
  const matches = report.matches.filter(match => match.isRemake !== true);
  const points = [...matches].reverse().map((match, index) => {
    let value = null;
    let perfect = false;
    if (metric.id === 'kda') {
      perfect = match.deaths === 0 && match.kills + match.assists > 0;
      value = match.deaths > 0 ? (match.kills + match.assists) / match.deaths : null;
    } else if (metric.id === 'kp') {
      value = match.teamKills > 0 ? ((match.kills + match.assists) / match.teamKills) * 100 : null;
    } else if (Number.isFinite(match[metric.field]) && match.durationMinutes > 0) {
      value = (match[metric.field] * (metric.scale || 1)) / match.durationMinutes;
    }
    return {index, match, value: Number.isFinite(value) ? value : null, perfect};
  });
  const groups = new Map();
  for (const match of matches) {
    const group = groups.get(match.champion) || {champion: match.champion, games: 0, wins: 0};
    group.games++;
    if (match.result === 'Victory') group.wins++;
    groups.set(match.champion, group);
  }
  const champions = [...groups.values()].sort(
    (a, b) => b.games - a.games || b.wins - a.wins || a.champion.localeCompare(b.champion),
  );
  const known = points.filter(point => point.value !== null);
  const max = Math.max(1, ...known.map(point => point.value));
  const step = 10 ** Math.floor(Math.log10(max));
  const ceiling = Math.ceil(max / step) * step;
  return {metric, points, known: known.length, ceiling, champions};
}

const format = value => new Intl.NumberFormat(getLocale(), {maximumFractionDigits: 1}).format(value);
function pointValue(point, metric) {
  return point.perfect
    ? t('Không chết')
    : point.value === null
      ? t('Chưa có dữ liệu')
      : format(point.value) + (metric.id === 'kp' ? '%' : '');
}
function pointDate(point) {
  return point.match.playedAt
    ? new Intl.DateTimeFormat(getLocale(), {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }).format(new Date(point.match.playedAt))
    : t('Chưa rõ ngày');
}
export function chartPointText(point, metric) {
  return `${t('Trận {n}', {n: point.index + 1})} · ${pointDate(point)} · ${point.match.champion} · ${t(point.match.result === 'Victory' ? 'Thắng' : 'Thua')} · ${t(metric.label)}: ${pointValue(point, metric)}`;
}
export function chartGeometry(points, ceiling) {
  const left = 56,
    right = 776,
    top = 18,
    bottom = 200;
  let drawing = false;
  let path = '';
  const positions = points.map((point, index) => {
    const x =
      points.length === 1
        ? (left + right) / 2
        : left + (index * (right - left)) / Math.max(1, points.length - 1);
    if (point.value === null) {
      drawing = false;
      return {x, y: null};
    }
    const y = bottom - (point.value / ceiling) * (bottom - top);
    path += `${drawing ? ' L' : ' M'}${x.toFixed(2)},${y.toFixed(2)}`;
    drawing = true;
    return {x, y};
  });
  return {positions, path: path.trim()};
}
export function renderStatsCharts(report, selectedMetric) {
  const data = buildChartData(report, selectedMetric);
  const {metric, points, ceiling, champions} = data;
  const options = chartMetrics(report.mode)
    .map(
      option =>
        `<option value="${option.id}"${option.id === metric.id ? ' selected' : ''}>${t(option.label)}</option>`,
    )
    .join('');
  const heading = `<div class="stats-chart-heading"><div><span class="eyebrow">${t('GÓC NHÌN DỮ LIỆU')}</span><h2>${t('Đồ thị thống kê')}</h2></div><label for="chart-metric">${t('Chỉ số trên đồ thị')}<select id="chart-metric">${options}</select></label></div>`;
  if (!points.length)
    return (
      heading +
      `<p class="empty-small">${t('Chưa có trận hợp lệ để vẽ đồ thị. Thử đổi bộ lọc hoặc nhập thêm lịch sử.')}</p>`
    );
  const {positions, path} = chartGeometry(points, ceiling);
  const ticks = Array.from({length: 5}, (_, i) => {
    const y = 200 - (i * 182) / 4;
    return `<line x1="56" y1="${y}" x2="776" y2="${y}" class="chart-gridline"/><text x="46" y="${y + 4}" text-anchor="end" class="chart-axis">${format((ceiling * i) / 4)}</text>`;
  }).join('');
  const dots = points
    .map((point, index) =>
      positions[index].y === null
        ? ''
        : `<circle cx="${positions[index].x}" cy="${positions[index].y}" r="4" data-chart-index="${index}" class="chart-dot ${point.match.result === 'Victory' ? 'is-win' : 'is-loss'}${index === points.length - 1 ? ' is-selected' : ''}"><title>${escape(chartPointText(point, metric))}</title></circle>`,
    )
    .join('');
  const rows = points
    .map(
      point =>
        `<tr><td>${point.index + 1}</td><td>${pointDate(point)}</td><th scope="row">${escape(point.match.champion)}</th><td>${t(point.match.result === 'Victory' ? 'Thắng' : 'Thua')}</td><td>${pointValue(point, metric)}</td></tr>`,
    )
    .join('');
  const bars = champions
    .slice(0, 6)
    .map(group => {
      const rate = (group.wins / group.games) * 100;
      const description = t('{games} trận · {wins} thắng / {losses} thua', {
        games: group.games,
        wins: group.wins,
        losses: group.games - group.wins,
      });
      return `<li><div class="champion-chart-label"><strong>${escape(group.champion)}</strong><span>${description}</span><b>${format(rate)}%</b></div><svg viewBox="0 0 100 8" preserveAspectRatio="none" role="img" aria-label="${escape(group.champion + ': ' + format(rate) + '% · ' + description)}"><rect width="100" height="8" rx="2" class="champion-loss-bar"/><rect width="${rate}" height="8" rx="2" class="champion-win-bar"/></svg></li>`;
    })
    .join('');
  return `${heading}
    <p class="chart-context">${t('{known}/{total} trận có giá trị số · cũ → mới · theo bộ lọc hiện tại.', {known: data.known, total: points.length})}</p>
    <p class="chart-note">${t(report.history.ordering === 'date' ? 'Trục ngang là thứ tự trận, không phải khoảng cách thời gian.' : 'Có trận thiếu ngày: dùng thứ tự nhập, cũ → mới.')}${metric.id === 'kda' ? ' ' + t('Trận không chết không quy đổi thành KDA số.') : ''}</p>
    <div class="chart-scroll" tabindex="0" role="region" aria-label="${t('Đồ thị theo trận, có thể cuộn ngang')}"><svg class="stats-line-chart" viewBox="0 0 800 236" role="img" aria-label="${escape(t(metric.label) + ' · ' + t('Cũ → mới'))}"><title>${t('Giá trị từng trận; bảng số liệu đầy đủ nằm bên dưới.')}</title>${ticks}<path d="${path}" class="chart-line"/>${dots}<text x="56" y="226" class="chart-axis">${t('Trận {n}', {n: 1})}</text><text x="776" y="226" text-anchor="end" class="chart-axis">${t('Trận {n}', {n: points.length})}</text></svg></div>
    ${data.known === 0 ? `<p class="chart-note">${t('Chưa có giá trị số cho chỉ số này. Chọn chỉ số khác hoặc bổ sung dữ liệu.')}</p>` : ''}
    <div class="chart-legend"><span class="win-text">● ${t('Thắng')}</span><span class="loss-text">● ${t('Thua')}</span><span>${t('Khoảng trống: thiếu giá trị số')}</span></div>
    <label class="chart-scrubber" for="chart-match">${t('Chọn trận để xem số liệu')}<input id="chart-match" type="range" min="0" max="${points.length - 1}" value="${points.length - 1}" step="1"${points.length === 1 ? ' disabled' : ''}></label>
    <p id="chart-point-detail" class="chart-point-detail" aria-live="polite">${escape(chartPointText(points.at(-1), metric))}</p>
    <p class="chart-note">${t('Không gộp SR với Mayhem; không tính remake. Khác biệt vai trò và tướng có thể ảnh hưởng chỉ số, đồ thị không kết luận tiến bộ.')}</p>
    <details class="chart-table-details"><summary>${t('Xem bảng số liệu đồ thị')}</summary><div class="chart-table-scroll" tabindex="0"><table class="chart-table"><caption>${t(metric.label)} · ${t('Cũ → mới')}</caption><thead><tr><th scope="col">#</th><th scope="col">${t('Thời điểm')}</th><th scope="col">${t('Tướng')}</th><th scope="col">${t('Kết quả')}</th><th scope="col">${t(metric.label)}</th></tr></thead><tbody>${rows}</tbody></table></div></details>
    <div class="champion-chart"><h3>${t('Tỉ lệ thắng theo tướng')}</h3><p class="chart-note">${t('Tối đa 6 tướng có nhiều trận nhất trong bộ lọc; luôn đọc cùng số trận.')}</p><ul>${bars}</ul></div>`;
}

export function updateChartPoint(container, report, metricId, index) {
  const data = buildChartData(report, metricId);
  const point = data.points[index];
  if (!point) return;
  container.querySelector('#chart-point-detail').textContent = chartPointText(point, data.metric);
  for (const dot of container.querySelectorAll('[data-chart-index]'))
    dot.classList.toggle('is-selected', Number(dot.dataset.chartIndex) === index);
}
