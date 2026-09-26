import mayhemMatchTranslations from './i18n-mayhem-match.js';
import mayhemDomainTranslations from './i18n-mayhem-domain.js';
import mayhemTranslations from './i18n-mayhem.js';
import staticTranslations from './i18n-en.js';
import appTranslations from './i18n-app.js';
import matchTranslations from './i18n-match.js';
import domainTranslations from './i18n-domain.js';

const translations = {...staticTranslations, ...appTranslations, ...matchTranslations, ...domainTranslations, ...mayhemTranslations, ...mayhemMatchTranslations, ...mayhemDomainTranslations};
const storageKey = 'rift-review-language';
const supported = value => value === 'vi' || value === 'en';
function savedLanguage() {
  try {
    const saved = globalThis.localStorage?.getItem(storageKey);
    return supported(saved) ? saved : 'vi';
  } catch { return 'vi'; }
}
let language = savedLanguage();
let listeners = [];
let initialized = false;

export const getLanguage = () => language;
export const getLocale = () => language === 'en' ? 'en-US' : 'vi-VN';
export function t(message, params = {}) {
  const source = String(message ?? '');
  const text = language === 'en' && Object.hasOwn(translations, source) ? translations[source] : source;
  return text.replace(/\{(\w+)\}/g, (token, key) => Object.hasOwn(params, key) ? String(params[key]) : token);
}
export function onLanguageChange(callback) {
  listeners = [...listeners, callback];
  return () => { listeners = listeners.filter(listener => listener !== callback); };
}
export function setLanguage(value) {
  if (!supported(value) || value === language) return;
  language = value;
  try { globalThis.localStorage?.setItem(storageKey, value); } catch { /* Private browsing can disable storage. */ }
  if (initialized) applyStaticTranslations();
  for (const callback of listeners) callback(language);
}

function applyStaticTranslations() {
  const doc = globalThis.document;
  if (!doc) return;
  doc.documentElement.lang = language;
  for (const element of doc.querySelectorAll('[data-i18n]')) {
    element.textContent = t(element.dataset.i18n);
  }
  for (const attribute of ['aria-label', 'title', 'placeholder', 'content']) {
    for (const element of doc.querySelectorAll(`[data-i18n-${attribute}]`)) {
      element.setAttribute(attribute, t(element.getAttribute(`data-i18n-${attribute}`)));
    }
  }
  for (const button of doc.querySelectorAll('[data-language]')) {
    button.setAttribute('aria-pressed', String(button.dataset.language === language));
  }
}

export function initLanguageUI() {
  if (!globalThis.document) return;
  if (!initialized) {
    for (const button of document.querySelectorAll('[data-language]')) {
      button.addEventListener('click', () => setLanguage(button.dataset.language));
    }
    initialized = true;
  }
  applyStaticTranslations();
}
