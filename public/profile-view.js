import {t} from './i18n.js';

const escape = value =>
  String(value ?? '').replace(
    /[&<>"']/g,
    char => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'})[char],
  );

export function renderProfileAvatar(profile) {
  const id = profile.profileIconId;
  const hasIcon = Number.isInteger(id) && id >= 0 && id <= 999999;
  const fallback = escape(
    String(profile.riotId || '?')
      .slice(0, 2)
      .toUpperCase(),
  );
  return `<div class="identity-avatar${hasIcon ? ' has-profile-icon' : ''}" role="img" aria-label="${escape(t(hasIcon ? 'Biểu tượng hồ sơ người chơi' : 'Hồ sơ chưa có biểu tượng'))}"><span aria-hidden="true">${fallback}</span>${hasIcon ? `<img data-profile-icon src="/api/profile-icon/${id}.png" width="64" height="64" alt="" decoding="async">` : ''}</div>`;
}
