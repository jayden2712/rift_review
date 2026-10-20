import {t} from './i18n.js';
import {formatMetric, metricLabel} from './comparison-view.js';

const PLAN_GAMES = 5;

function focusRow(item, complete) {
  const status =
    item.current === null
      ? `<span class="plan-status">${t('Chưa có dữ liệu')}</span>`
      : !complete
        ? `<span class="plan-status">${t('Đang theo dõi')}</span>`
        : item.met
          ? `<span class="plan-status is-met">${t('Đạt mục tiêu')}</span>`
          : `<span class="plan-status is-missed">${t('Chưa đạt')}</span>`;
  return `<li><span class="plan-metric">${metricLabel(item.id)}</span><span class="plan-values">${formatMetric(item.id, item.baseline)} <span class="trend-arrow">→</span> <strong>${formatMetric(item.id, item.current)}</strong> <span class="muted">${t('mục tiêu {target}', {target: formatMetric(item.id, item.target)})}</span></span>${status}</li>`;
}

// candidates: metric ids a new plan would track; evaluation: evaluatePlan() result or null.
export function renderPlanTracker({candidates, evaluation, canTrack}) {
  if (!canTrack)
    return `<div class="plan-tracker"><p class="small muted">${t('Tra cứu bằng Riot ID để theo dõi kế hoạch qua các trận tiếp theo.')}</p></div>`;
  if (!evaluation) {
    if (!candidates.length)
      return `<div class="plan-tracker"><p class="small muted">${t('Chưa có chỉ số đủ rõ để đặt mục tiêu theo dõi.')}</p></div>`;
    return `<div class="plan-tracker"><p>${t('Theo dõi tự động: {metrics}. Mục tiêu là cải thiện 10% so với mức hiện tại trong {n} trận tiếp theo.', {metrics: candidates.map(metricLabel).join(', '), n: PLAN_GAMES})}</p><button type="button" class="primary-btn" data-plan-start>${t('Bắt đầu theo dõi 5 trận tới')}</button></div>`;
  }
  const met = evaluation.focus.filter(item => item.met).length;
  const headline = evaluation.complete
    ? t('Kế hoạch hoàn tất: đạt {met}/{total} mục tiêu.', {met, total: evaluation.focus.length})
    : t('Đã chơi {played}/{n} trận sau khi bắt đầu kế hoạch.', {played: evaluation.played, n: PLAN_GAMES});
  return `<div class="plan-tracker is-active"><div class="plan-head"><strong>${headline}</strong><meter min="0" max="${PLAN_GAMES}" value="${Math.min(evaluation.played, PLAN_GAMES)}" aria-hidden="true"></meter></div><ul class="plan-focus">${evaluation.focus.map(item => focusRow(item, evaluation.complete)).join('')}</ul><button type="button" class="secondary-btn" data-plan-clear>${evaluation.complete ? t('Kết thúc và tạo kế hoạch mới') : t('Huỷ kế hoạch')}</button><p class="small muted">${t('Tra cứu lại sau khi chơi để cập nhật. Kế hoạch chỉ lưu trên trình duyệt này.')}</p></div>`;
}
