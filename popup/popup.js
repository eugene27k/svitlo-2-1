// Вікно розширення (В4.7–В4.10): лише рендер даних зі storage, логіка — у чистих модулях.
import { popupModel, buildReport, timelineModel, zoneShort, TEST_NOTIFICATION, TOOLBAR_TITLES } from '../src/texts.js';
import { fmtHM } from '../src/schedule.js';
import {
  THEME_STORAGE_KEY, THEME_META, nextThemePreference, themeAttr, normalizeThemePreference,
} from '../src/theme.js';

const STATE_KEY = 'svitlo:state';
const LOG_KEY = 'svitlo:log';
const RAW_KEY = 'svitlo:raw';
const $ = (id) => document.getElementById(id);

async function loadAll() {
  const keys = await chrome.storage.local.get([STATE_KEY, LOG_KEY, RAW_KEY]);
  return {
    state: keys[STATE_KEY] ?? null,
    log: keys[LOG_KEY] ?? [],
    raw: keys[RAW_KEY] ?? { success: null, fail: null },
  };
}

function fillSegments(ul, list) {
  ul.textContent = '';
  for (const line of list) {
    const li = document.createElement('li');
    li.textContent = line;
    const zone = line.includes('червона') ? 'red' : line.includes('жовта') ? 'yellow' : 'green';
    li.className = zone;
    ul.appendChild(li);
  }
}

/* Смуги доби: рендер готової моделі timelineModel (завжди видимі) */
const RULER_HOURS = [0, 3, 6, 9, 12, 15, 18, 21, 24];

function timelineDay(tl, day, emptyText) {
  const wrap = document.createElement('div');
  wrap.className = 'tl-day';

  if (day.empty) {
    const empty = document.createElement('div');
    empty.className = 'tl-empty';
    empty.textContent = emptyText;
    wrap.appendChild(empty);
    return wrap;
  }

  const bar = document.createElement('div');
  bar.className = 'tl-bar';
  for (const b of day.bars) {
    const seg = document.createElement('div');
    seg.className = `seg ${b.zone}`;
    seg.style.width = `${b.pct}%`;
    seg.title = b.tooltip;
    bar.appendChild(seg);
  }
  if (day === tl.today) {
    const marker = document.createElement('div');
    marker.className = 'tl-now';
    marker.style.left = `${tl.nowPct}%`;
    marker.title = 'Зараз';
    bar.appendChild(marker);
  }
  wrap.appendChild(bar);

  const ruler = document.createElement('div');
  ruler.className = 'tl-ruler';
  for (const h of RULER_HOURS) {
    const tick = document.createElement('span');
    if (h === 0) tick.className = 'edge-l';
    else if (h === 24) tick.className = 'edge-r';
    tick.style.left = `${(h / 24) * 100}%`;
    tick.textContent = fmtHM(h * 60);
    ruler.appendChild(tick);
  }
  wrap.appendChild(ruler);

  const legend = document.createElement('div');
  legend.className = 'tl-legend';
  for (const l of day.legend) {
    const item = document.createElement('span');
    const dot = document.createElement('span');
    dot.className = `dot ${l.zone}`; // колір крапки — з палітри теми в CSS
    item.appendChild(dot);
    item.append(`${zoneShort(l.zone)} — ${l.text}`);
    legend.appendChild(item);
  }
  wrap.appendChild(legend);
  return wrap;
}

async function render() {
  const { state } = await loadAll();
  const now = new Date();
  const m = popupModel({ state, now });
  const tl = timelineModel({ state, now });

  $('title').textContent = m.title;
  $('current').textContent = m.currentLine;
  $('next').textContent = m.nextLine ?? '';

  const unknown = $('unknown-types');
  if (m.unknownTypeNotes.length) {
    unknown.textContent = m.unknownTypeNotes.join(' ');
    unknown.classList.remove('hidden');
  } else unknown.classList.add('hidden');

  $('today-title').textContent = m.todayTitle;
  const tlToday = $('tl-today');
  tlToday.textContent = '';
  tlToday.appendChild(timelineDay(tl, tl.today, 'Графіка на сьогодні немає'));
  fillSegments($('today'), m.todayList);
  $('tomorrow-title').textContent = m.tomorrowTitle;
  const tlTomorrow = $('tl-tomorrow');
  tlTomorrow.textContent = '';
  tlTomorrow.appendChild(timelineDay(tl, tl.tomorrow, m.tomorrowNote ?? 'Графік ще не опубліковано'));
  fillSegments($('tomorrow'), m.tomorrowList);

  $('updated').textContent = m.updatedLine;
  $('verify').textContent = m.verifyLine;
  $('checks-line').textContent = m.checksLine;
  const list = $('checks-list');
  list.textContent = '';
  if (m.checksList.length && m.checksLine !== 'Перевірки: усе гаразд') {
    for (const line of m.checksList) {
      const li = document.createElement('li');
      li.textContent = line;
      if (line.includes('помилка')) li.className = 'error';
      else if (line.includes('попередження')) li.className = 'warn';
      list.appendChild(li);
    }
    list.classList.remove('hidden');
  } else list.classList.add('hidden');

  // В4.8: перевірка дозволу сповіщень
  chrome.notifications.getPermissionLevel((level) => {
    $('notifications-denied').classList.toggle('hidden', level !== 'denied');
  });
}

/* Кнопка «Оновити зараз» (В1.2) */
$('refresh').addEventListener('click', () => {
  $('refresh').disabled = true;
  chrome.runtime.sendMessage({ type: 'refresh' }, () => {
    $('refresh').disabled = false;
    render();
  });
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === 'refresh-done') render();
});

/* Іконка «Копіювати звіт» (В6.5–В6.6): підказка з texts.js, «скопійовано» — зелона галочка */
$('copy-report').addEventListener('click', async () => {
  const { state, log, raw } = await loadAll();
  const alarms = await chrome.alarms.getAll();
  const report = buildReport({
    extensionVersion: chrome.runtime.getManifest().version,
    userAgent: navigator.userAgent,
    systemTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    now: new Date(),
    state, log, alarms, raw,
  });
  try {
    await navigator.clipboard.writeText(report);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = report;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  const btn = $('copy-report');
  btn.classList.add('copied');
  setTimeout(() => btn.classList.remove('copied'), 2500);
});

/* Кнопка «Надіслати тестове сповіщення» (В4.9) */
$('test-notification').addEventListener('click', () => {
  chrome.notifications.create({
    type: 'basic',
    iconUrl: chrome.runtime.getURL('icons/gray.png'),
    title: TEST_NOTIFICATION.title,
    message: TEST_NOTIFICATION.message,
  });
});

/* Кнопка «Прослухати звуки зон» (В3.19): зелений, жовтий, червоний підряд */
$('test-sounds').addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'play-test-sounds' }, () => {});
});

/* Тема вікна: system → light → dark. У режимі «system» тему обирає ОС напряму
   в CSS (color-scheme + light-dark()) і змінюється на льоту без JavaScript;
   тут лише ставимо явний data-theme, оновлюємо кнопку і пам'ятаємо вибір. */
let themePref = 'system';

function applyTheme() {
  const attr = themeAttr(themePref);
  if (attr) document.documentElement.setAttribute('data-theme', attr);
  else document.documentElement.removeAttribute('data-theme');
  const meta = THEME_META[themePref];
  const btn = $('theme-toggle');
  btn.dataset.mode = themePref;
  btn.title = meta.title;
  btn.setAttribute('aria-label', meta.title);
}

/* Підказки іконок шапки: спливаюча підказка (title) = aria-label, тексти — у texts.js */
const TITLE_TARGETS = {
  refresh: 'refresh',
  copyReport: 'copy-report',
  testNotification: 'test-notification',
  sounds: 'test-sounds',
  openSite: 'open-site',
};
for (const [key, id] of Object.entries(TITLE_TARGETS)) {
  const el = $(id);
  el.title = TOOLBAR_TITLES[key];
  el.setAttribute('aria-label', TOOLBAR_TITLES[key]);
}

async function initTheme() {
  const stored = await chrome.storage.local.get(THEME_STORAGE_KEY);
  themePref = normalizeThemePreference(stored[THEME_STORAGE_KEY]);
  applyTheme();
}

$('theme-toggle').addEventListener('click', () => {
  themePref = nextThemePreference(themePref);
  applyTheme();
  chrome.storage.local.set({ [THEME_STORAGE_KEY]: themePref });
});

initTheme();
render();
