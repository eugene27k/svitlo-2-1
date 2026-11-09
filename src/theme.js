// Тема вікна розширення: системна / світла / темна.
// Чиста логіка без chrome.* і DOM — popup лише застосовує результат (В-патерн проєкту).
// У режимі «system» тему обирає ОС сам через CSS (color-scheme + light-dark()),
// тому data-theme на <html> ставиться лише для явних «light»/«dark».

export const THEME_STORAGE_KEY = 'svitlo:theme';
export const THEME_PREFS = ['system', 'light', 'dark'];

/** Підказка (title) іконки теми для кожної переваги — видимого підпису немає */
export const THEME_META = {
  system: { title: 'Тема: як у системі (клацніть — світла)' },
  light: { title: 'Тема: світла (клацніть — темна)' },
  dark: { title: 'Тема: темна (клацніть — системна)' },
};

/** Наступна перевага в циклі system → light → dark → system; невідома → як system */
export function nextThemePreference(pref) {
  const i = THEME_PREFS.indexOf(normalizeThemePreference(pref));
  return THEME_PREFS[(i + 1) % THEME_PREFS.length];
}

/**
 * Атрибут data-theme для <html>: 'light'/'dark' для явного вибору,
 * null для «system» — тоді тему вирішує media query ОС без JavaScript.
 */
export function themeAttr(pref) {
  return pref === 'light' || pref === 'dark' ? pref : null;
}

/** Валідація значення зі storage: невідоме або відсутнє → 'system' */
export function normalizeThemePreference(value) {
  return THEME_PREFS.includes(value) ? value : 'system';
}
