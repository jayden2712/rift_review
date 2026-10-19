import test from 'node:test';
import assert from 'node:assert/strict';
import {tooltipContent} from '../public/tooltip.js';
import {renderItemSlots, renderLoadout} from '../public/match-view.js';

const data = {
  item: {3111: {name: 'Giày Thủy Ngân', text: '20 Kháng Phép\n45 Tốc Độ', price: 1250}},
  augment: {1386: 'Bắn dây móc <img src=x onerror=alert(1)>\nđu vòng'},
};

test('item tooltips show the localized name, price and description lines', () => {
  const html = tooltipContent('item', 3111, data, 'vi');
  assert.match(html, /Giày Thủy Ngân/);
  assert.match(html, /1\.250|1,250/);
  assert.match(html, /20 Kháng Phép<br>45 Tốc Độ/);
  assert.equal(tooltipContent('item', 999, data, 'vi'), null);
});

test('augment tooltips show name, rarity and escaped description', () => {
  const html = tooltipContent('augment', 1386, data, 'vi');
  assert.match(html, /Đi Đu Đưa Đi/);
  assert.match(html, /tooltip-rarity augment-silver/);
  assert.match(html, /&lt;img src=x/);
  assert.doesNotMatch(html, /<img src=x/);
  // Known augment without a vendored description still gets its name.
  assert.match(tooltipContent('augment', 1, {item: {}, augment: {}}, 'en'), /Accelerating Sorcery/);
  assert.equal(tooltipContent('augment', 999999, data, 'vi'), null);
});

test('item and augment icons carry tooltip hooks without native title tooltips', () => {
  const items = renderItemSlots({items: [3111, 0]});
  assert.match(items, /data-tip-kind="item" data-tip-id="3111"/);
  assert.doesNotMatch(items, /data-tip-id="0"/);
  const loadout = renderLoadout({augments: [{id: 1386}]}, {mayhem: true});
  assert.match(loadout, /data-tip-kind="augment" data-tip-id="1386"/);
});
