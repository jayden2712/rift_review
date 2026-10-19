import {t, getLanguage} from './i18n.js';
import {augmentAsset} from './augment-assets.js';

const escape = value =>
  String(value ?? '').replace(
    /[&<>"']/g,
    char => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'})[char],
  );
const TOP_ROWS = 12;
// Below this many picks a win rate swings too much to read as a tendency.
const SMALL_SAMPLE = 3;

function row(entry, max) {
  const asset = augmentAsset(entry.id, getLanguage());
  const name = asset?.name || t('Augment #{id}', {id: entry.id});
  const rate = Math.round(entry.winRate * 100);
  const image = asset
    ? `<img src="${escape(asset.src)}" alt="" width="32" height="32" loading="lazy" decoding="async">`
    : '';
  return `<li class="augment-stat${asset?.rarity ? ' augment-' + asset.rarity : ''}${entry.picks < SMALL_SAMPLE ? ' is-small-sample' : ''}" data-augment-id="${entry.id}"><span class="game-icon augment-icon" aria-hidden="true"><span class="game-icon-fallback">·</span>${image}</span><span class="augment-stat-name">${escape(name)}</span><span class="augment-stat-picks" title="${escape(t('{picks} lần chọn', {picks: entry.picks}))}"><svg class="augment-pick-bar" viewBox="0 0 100 6" preserveAspectRatio="none" aria-hidden="true"><rect width="${Math.max(4, Math.round((entry.picks / max) * 100))}" height="6" rx="3"/></svg>${entry.picks}</span><span class="augment-stat-rate ${rate >= 50 ? 'win-text' : 'loss-text'}">${rate}%</span></li>`;
}

export function renderAugmentPanel(stats, scope = 'self') {
  const current = scope === 'lobby' ? stats?.lobby : stats?.self;
  const tabs = [
    ['self', t('Của bạn')],
    ['lobby', t('Cả 10 người')],
  ]
    .map(
      ([value, label]) =>
        `<button type="button" class="scope-tab${value === scope ? ' is-active' : ''}" data-augment-scope="${value}" aria-pressed="${value === scope}">${label}</button>`,
    )
    .join('');
  const heading = `<div class="panel-heading"><h2>${t('Augment hay chọn')}</h2><div class="scope-tabs" role="group" aria-label="${escape(t('Phạm vi thống kê augment'))}">${tabs}</div></div>`;
  if (!current?.rows.length)
    return `${heading}<p class="small muted">${t('Chưa có dữ liệu augment. Nhập trận Mayhem từ client LoL để thống kê.')}</p>`;
  const caption =
    scope === 'lobby'
      ? t('{players} lượt chọn của mọi người chơi trong {games} trận', {
          players: current.players,
          games: current.games,
        })
      : t('{games} trận của bạn có dữ liệu augment', {games: current.games});
  const max = current.rows[0].picks;
  return `${heading}<p class="small muted">${caption}</p><ol class="augment-stats-list"><li class="augment-stat augment-stat-head" aria-hidden="true"><span></span><span>Augment</span><span>${t('Lượt chọn')}</span><span>${t('Tỉ lệ thắng')}</span></li>${current.rows
    .slice(0, TOP_ROWS)
    .map(entry => row(entry, max))
    .join(
      '',
    )}</ol><p class="small muted trend-note">${t('Chỉ mô tả kết quả. Augment dưới {n} lượt chọn được làm mờ vì mẫu quá nhỏ.', {n: SMALL_SAMPLE})}</p>`;
}
