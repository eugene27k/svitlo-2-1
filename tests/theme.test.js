// Тести теми вікна (системна/світла/темна) — чиста логіка без chrome.* і DOM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  THEME_PREFS, THEME_META, THEME_STORAGE_KEY,
  nextThemePreference, themeAttr, normalizeThemePreference,
} from '../src/theme.js';

test('Цикл теми: system → light → dark → system', () => {
  assert.equal(nextThemePreference('system'), 'light');
  assert.equal(nextThemePreference('light'), 'dark');
  assert.equal(nextThemePreference('dark'), 'system');
});

test('Цикл теми: невідома перевага поводиться як system', () => {
  assert.equal(nextThemePreference('неіснуюча'), 'light');
  assert.equal(nextThemePreference(undefined), 'light');
});

test('themeAttr: явна тема — атрибут data-theme, system — null (тему обирає ОС через CSS)', () => {
  assert.equal(themeAttr('light'), 'light');
  assert.equal(themeAttr('dark'), 'dark');
  assert.equal(themeAttr('system'), null);
});

test('normalizeThemePreference: валідні значення проходять, усе інше → system', () => {
  for (const p of THEME_PREFS) assert.equal(normalizeThemePreference(p), p);
  assert.equal(normalizeThemePreference('blue'), 'system');
  assert.equal(normalizeThemePreference(null), 'system');
  assert.equal(normalizeThemePreference(undefined), 'system');
});

test('THEME_META: для кожної переваги є непорожній title (підказка іконки), без зайвих', () => {
  assert.deepEqual(Object.keys(THEME_META).sort(), [...THEME_PREFS].sort());
  for (const p of THEME_PREFS) {
    assert.ok(THEME_META[p].title.length > 0, `title для ${p}`);
    assert.equal(THEME_META[p].label, undefined, `label для ${p} більше не потрібен`);
  }
});

test('Ключ storage теми — контракт з popup', () => {
  assert.equal(THEME_STORAGE_KEY, 'svitlo:theme');
});
