import test from 'node:test';
import assert from 'node:assert/strict';

const fresh = () => import(`../public/i18n.js?test=${Math.random()}`);

test('language defaults to Vietnamese and translates only supported source strings', async () => {
  const i18n = await fresh();
  assert.equal(i18n.getLanguage(), 'vi');
  assert.equal(i18n.getLocale(), 'vi-VN');
  assert.equal(i18n.t('Lịch sử trận'), 'Lịch sử trận');
  i18n.setLanguage('en');
  assert.equal(i18n.getLocale(), 'en-US');
  assert.equal(i18n.t('Lịch sử trận'), 'Match history');
  assert.equal(i18n.t('Unknown Riot ID#123'), 'Unknown Riot ID#123');
  assert.equal(i18n.t('{name}: {count}', {name: '<script>', count: 0}), '<script>: 0');
});

test('invalid language is ignored and callbacks can unsubscribe', async () => {
  const i18n = await fresh();
  const calls = [];
  const off = i18n.onLanguageChange(language => calls.push(language));
  i18n.setLanguage('fr');
  assert.equal(i18n.getLanguage(), 'vi');
  i18n.setLanguage('en');
  i18n.setLanguage('en');
  off();
  i18n.setLanguage('vi');
  assert.deepEqual(calls, ['en']);
});

test('saved language survives reload and blocked storage is harmless', async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const values = new Map([['rift-review-language', 'en']]);
  try {
    Object.defineProperty(globalThis, 'localStorage', {configurable: true, value: {
      getItem: key => values.get(key), setItem: (key, value) => values.set(key, value),
    }});
    const i18n = await fresh();
    assert.equal(i18n.getLanguage(), 'en');
    i18n.setLanguage('vi');
    assert.equal(values.get('rift-review-language'), 'vi');
    Object.defineProperty(globalThis, 'localStorage', {configurable: true, get() {throw new Error('Storage blocked');}});
    const blocked = await fresh();
    assert.doesNotThrow(() => blocked.setLanguage('en'));
    assert.equal(blocked.getLanguage(), 'en');
  } finally {
    if (original) Object.defineProperty(globalThis, 'localStorage', original);
    else delete globalThis.localStorage;
  }
});

// Exercise the DOM contract without adding a browser dependency to unit tests.
test('explicit markers update UI and accessibility without touching form data', async () => {
  const i18n = await fresh();
  const original = globalThis.document;
  const controls = ['vi', 'en'].map(language => ({
    dataset: {language}, attributes: {}, callbacks: [],
    setAttribute(name, value) { this.attributes = {...this.attributes, [name]: value}; },
    addEventListener(name, callback) { this.callbacks = [...this.callbacks, {name, callback}]; },
  }));
  const label = {dataset: {i18n: 'Lịch sử trận'}, textContent: 'Lịch sử trận'};
  const input = {
    value: 'Tên người chơi#VN', attributes: {'data-i18n-placeholder': 'Tên#TAG'},
    getAttribute(name) { return this.attributes[name]; },
    setAttribute(name, value) { this.attributes = {...this.attributes, [name]: value}; },
  };
  try {
    globalThis.document = {
      documentElement: {lang: 'vi'},
      querySelectorAll(selector) {
        return ({'[data-i18n]': [label], '[data-i18n-placeholder]': [input], '[data-language]': controls})[selector] || [];
      },
    };
    i18n.initLanguageUI();
    i18n.initLanguageUI();
    assert.equal(controls[1].callbacks.length, 1);
    controls[1].callbacks[0].callback();
    assert.equal(label.textContent, 'Match history');
    assert.equal(document.documentElement.lang, 'en');
    assert.equal(controls[1].attributes['aria-pressed'], 'true');
    assert.equal(controls[0].attributes['aria-pressed'], 'false');
    assert.equal(input.attributes.placeholder, 'Name#TAG');
    assert.equal(input.value, 'Tên người chơi#VN');
  } finally {
    if (original) globalThis.document = original;
    else delete globalThis.document;
  }
});
