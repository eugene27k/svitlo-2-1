// Фоновий service worker: розклад, отримання даних, сигнали, мітка (В1, В3, В5).
// Стан тримається лише в chrome.storage.local (PRD 4.7), не в змінних.
import { QUEUE } from './schedule.js';
import { fetchAll } from './api.js';
import { validateData } from './validate.js';
import { planNotifications, handleNotifyFire, nextRetryDelayMin } from './plan.js';
import { diffGraphs, graphChangeNotification, tomorrowAppearedNotification } from './diff.js';
import { badgeState, currentZoneNotification, fmtDMHM, queueIdChangedNotification, fetchFailureNotification } from './texts.js';
import { ensureBlink, stopBlink } from './blink.js';
import { soundForSend } from './sound.js';

import { makeEntry, appendEntries, checkToEntries } from './log.js';

const STATE_KEY = 'svitlo:state';
const LOG_KEY = 'svitlo:log';
const RAW_KEY = 'svitlo:raw';
const FETCH_ALARM = 'svitlo-fetch';
const TICK_ALARM = 'svitlo-tick';
const NOTIFY_PREFIX = 'svitlo-notify-';
const SITE_URL = 'https://off.energy.mk.ua/';
const HOURLY_MIN = 60;
const STALE_REFRESH_MS = 5 * 60_000; // захист від паралельних оновлень

const DEFAULT_STATE = {
  version: 1,
  queue: { name: QUEUE.name, expectedId: QUEUE.expectedId, foundId: null, verifiedAt: null },
  days: null,
  checks: [],
  lastAttemptAt: null,
  lastAttemptOk: null,
  lastSuccessAt: null,
  consecutiveFailures: 0,
  failureNotified: false,
  queueIdNotifiedFor: null,
  notifiedZone: null,
  nextUpdateAt: null,
  plannedMoments: {},
  refreshingAt: null,
};

/* ---------- storage ---------- */

async function getState() {
  const got = await chrome.storage.local.get(STATE_KEY);
  return { ...DEFAULT_STATE, ...(got[STATE_KEY] ?? {}), queue: { ...DEFAULT_STATE.queue, ...(got[STATE_KEY]?.queue ?? {}) } };
}
const saveState = (state) => chrome.storage.local.set({ [STATE_KEY]: state });

async function getLog() {
  return (await chrome.storage.local.get(LOG_KEY))[LOG_KEY] ?? [];
}
async function writeLog(entries) {
  for (const e of entries) console.log(`[Світло 2.1] ${e.level} ${e.stage}${e.check ? ` ${e.check}` : ''} ${e.message}`, e.details ?? ''); // В6.3
  const log = await getLog();
  await chrome.storage.local.set({ [LOG_KEY]: appendEntries(log, entries) });
}

async function saveRaw(kind, responses, epoch) {
  const raw = (await chrome.storage.local.get(RAW_KEY))[RAW_KEY] ?? { success: null, fail: null };
  raw[kind] = {
    savedAt: epoch,
    timeSeries: responses.timeSeries.bodyText,
    queues: responses.queues.bodyText,
    schedules: responses.schedules.bodyText,
  };
  await chrome.storage.local.set({ [RAW_KEY]: raw });
}

/* ---------- сповіщення ---------- */

function iconFor(zone) {
  const file = { red: 'red', yellow: 'yellow', green: 'green' }[zone] ?? 'gray';
  return chrome.runtime.getURL(`icons/${file}.png`);
}

async function showNotification({ title, message, zone = 'none' }) {
  await chrome.notifications.create({
    type: 'basic',
    iconUrl: iconFor(zone), // В3.13: значок кольору зони
    title,
    message,
  });
}

/* ---------- звук сповіщень (В3.18–В3.20) ---------- */

const OFFSCREEN_URL = 'src/offscreen.html';
let creatingOffscreen = null;

async function ensureOffscreenDoc() {
  if (await chrome.offscreen.hasDocument()) return;
  creatingOffscreen ??= chrome.offscreen
    .createDocument({ url: OFFSCREEN_URL, reasons: ['AUDIO_PLAYBACK'], justification: 'Звук сповіщень про зміну зони' })
    .finally(() => { creatingOffscreen = null; });
  await creatingOffscreen;
}

async function playSoundById(id) {
  await ensureOffscreenDoc();
  await chrome.runtime.sendMessage({ type: 'play-sound', sound: id });
}

async function playZoneSound(send) { // В3.18: T-15 і момент зміни; T-30 — без звуку
  const id = soundForSend(send);
  if (!id) return;
  try {
    await playSoundById(id);
  } catch (e) {
    await writeLog([makeEntry({ level: 'WARN', stage: 'SOUND', message: `Не вдалося відтворити звук «${id}»: ${e?.message ?? e}` })]);
  }
}

/* ---------- мітка (В4) ---------- */

async function updateBadge() {
  try {
    const state = await getState();
    const b = badgeState({ days: state.days, now: new Date(), lastSuccessAt: state.lastSuccessAt });
    await chrome.action.setBadgeText({ text: b.text });
    if (b.blink) {
      ensureBlink({ // В4.11: моргання між поточною та наступною зоною до моменту зміни
        colorA: b.color,
        colorB: b.blink.color,
        until: b.blink.until,
        setColor: (color) => chrome.action.setBadgeBackgroundColor({ color }),
        onEnd: () => updateBadge(), // зміна настала — сталий колір нової зони
      });
    } else {
      stopBlink();
      await chrome.action.setBadgeBackgroundColor({ color: b.color });
    }
  } catch (e) {
    await writeLog([makeEntry({ level: 'ERROR', stage: 'BADGE', message: `Не вдалося оновити мітку: ${e?.message ?? e}` })]);
  }
}

/* ---------- розклад ---------- */

async function scheduleFetchAt(state, epoch, reason) {
  await chrome.alarms.clear(FETCH_ALARM);
  chrome.alarms.create(FETCH_ALARM, { when: epoch });
  state.nextUpdateAt = epoch;
  await writeLog([makeEntry({ level: 'INFO', stage: 'SCHEDULE', message: `Наступне оновлення о ${fmtDMHM(epoch)} за Києвом (${reason})` })]);
}

async function replanNotifications(state, now) {
  const all = await chrome.alarms.getAll();
  for (const a of all) if (a.name.startsWith(NOTIFY_PREFIX)) await chrome.alarms.clear(a.name);
  const { moments } = planNotifications({ days: state.days, now }); // В3.3: після кожного успішного оновлення
  const map = {};
  moments.forEach((m, i) => {
    const name = `${NOTIFY_PREFIX}${i}`;
    chrome.alarms.create(name, { when: m.at });
    map[name] = m;
  });
  state.plannedMoments = map;
  await writeLog([makeEntry({ level: 'INFO', stage: 'SCHEDULE', message: `Заплановано сигналів: ${moments.length}` })]);
}

/* ---------- отримання даних (В1, В2) ---------- */

async function refresh(trigger) {
  const now = new Date();
  let state = await getState();
  if (state.refreshingAt && now.getTime() - state.refreshingAt < STALE_REFRESH_MS) return; // вже триває
  state.refreshingAt = now.getTime();
  await saveState(state);

  try {
    const responses = await fetchAll();
    const v = validateData({ responses, now, queueName: QUEUE.name, expectedQueueId: QUEUE.expectedId });

    state = await getState(); // перечитати після запитів
    state.lastAttemptAt = now.getTime();
    state.lastAttemptOk = v.ok;
    state.checks = v.checks;

    const raws = responses;
    if (v.ok) {
      const oldDays = state.days; // В2.13–В2.14: попереджень немає помилок → дані заміннюються
      const diff = diffGraphs({ oldDays, newDays: v.data.days, now });
      state.days = v.data.days;
      state.queue.foundId = v.data.queueId;
      state.queue.verifiedAt = now.getTime();
      state.lastSuccessAt = now.getTime();
      state.consecutiveFailures = 0;
      state.failureNotified = false;
      await saveRaw('success', raws, now.getTime());

      // П5: зміна внутрішнього номера — сповіщення один раз
      if (v.data.queueId !== QUEUE.expectedId && state.queueIdNotifiedFor !== v.data.queueId) {
        await showNotification({ ...queueIdChangedNotification(v.data.queueId), zone: 'none' });
        state.queueIdNotifiedFor = v.data.queueId;
        await writeLog([makeEntry({ level: 'WARN', stage: 'RESOLVE_QUEUE', check: 'П5', message: `Сповіщення: номер черги змінився на ${v.data.queueId}` })]);
      } else if (v.data.queueId === QUEUE.expectedId) {
        state.queueIdNotifiedFor = null;
      }

      await replanNotifications(state, now);

      // В5: порівняння з попередніми даними (після першого встановлення не надсилається, В5.8)
      if (oldDays) {
        const n = graphChangeNotification(diff);
        if (n) {
          await showNotification({ ...n, zone: 'red' });
          await writeLog([makeEntry({ level: 'INFO', stage: 'NOTIFY', message: 'Сповіщення: графік змінився', details: { lines: diff.lines } })]);
        }
        if (diff.tomorrowAppeared) {
          const t = tomorrowAppearedNotification({ date: diff.tomorrowDate, days: v.data.days });
          await showNotification({ ...t, zone: 'yellow' });
          await writeLog([makeEntry({ level: 'INFO', stage: 'NOTIFY', message: `Сповіщення: з’явився графік на ${diff.tomorrowDate}` })]);
        }
      }

      await scheduleFetchAt(state, now.getTime() + HOURLY_MIN * 60_000, 'успіх, раз на годину');
    } else {
      state.consecutiveFailures += 1;
      await saveRaw('fail', raws, now.getTime()); // В2.5: працюємо на останніх успішних даних
      if (state.consecutiveFailures === 3 && !state.failureNotified) { // В2.15
        await showNotification({ ...fetchFailureNotification(state.lastSuccessAt), zone: 'none' });
        state.failureNotified = true;
        await writeLog([makeEntry({ level: 'ERROR', stage: 'NOTIFY', message: 'Сповіщення: не вдалося оновити графік (3 спроби поспіль)' })]);
      }
      const delayMin = nextRetryDelayMin(state.consecutiveFailures); // В1.4
      await scheduleFetchAt(state, now.getTime() + delayMin * 60_000, `повторна спроба ${state.consecutiveFailures}, через ${delayMin} хв`);
    }

    state.refreshingAt = null;
    await saveState(state);
    await writeLog(checkToEntries(v.checks, now));
    await updateBadge();
  } catch (e) {
    state = await getState();
    state.refreshingAt = null;
    await saveState(state);
    await writeLog([makeEntry({ level: 'ERROR', stage: 'COMPUTE', message: `Непередбачена помилка оновлення: ${e?.stack ?? e}` })]);
  } finally {
    chrome.runtime.sendMessage({ type: 'refresh-done' }).catch(() => {}); // popup може бути закритий
  }
}

/* ---------- сигнали ---------- */

async function onNotifyAlarm(alarm) {
  const state = await getState();
  const moment = state.plannedMoments?.[alarm.name];
  if (!moment) return;
  const { sends, newNotifiedZone } = handleNotifyFire({
    moment,
    firedAt: Date.now(),
    days: state.days,
    notifiedZone: state.notifiedZone,
  });
  for (const s of sends) {
    await showNotification({ title: s.title, message: s.message, zone: s.zone });
    await playZoneSound(s); // В3.18: звук кольору зони для T-15 і моменту зміни
    await writeLog([makeEntry({ level: 'INFO', stage: 'NOTIFY', message: `Сповіщення (${s.kind}): ${s.title}`, details: { plannedAt: new Date(moment.at).toISOString() } })]);
  }
  if (newNotifiedZone) {
    state.notifiedZone = newNotifiedZone;
    await saveState(state);
  }
}

async function onTick() {
  await updateBadge(); // В4.6: щохвилини зі збережених даних
  const state = await getState();
  // В1.7: комп'ютер спав під час планового отримання — беремо дані одразу після пробудження
  if (state.nextUpdateAt && Date.now() > state.nextUpdateAt + 2 * 60_000) {
    return refresh('missed-while-asleep');
  }
  // В3.16: після пробудження/запуску — одне сповіщення, якщо зона змінилася
  const cur = currentZoneNotification({ days: state.days, now: new Date() });
  if (cur && state.notifiedZone != null && cur.zone !== state.notifiedZone) {
    await showNotification({ title: cur.title, message: cur.message, zone: cur.zone });
    await playZoneSound({ kind: 'reconcile', offset: 0, zone: cur.zone }); // В3.20
    state.notifiedZone = cur.zone;
    await saveState(state);
    await writeLog([makeEntry({ level: 'INFO', stage: 'NOTIFY', message: `Сповіщення після пробудження: ${cur.title}` })]);
  }
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === FETCH_ALARM) return refresh('alarm');
  if (alarm.name === TICK_ALARM) return onTick();
  if (alarm.name.startsWith(NOTIFY_PREFIX)) return onNotifyAlarm(alarm);
});

/* ---------- події життєвого циклу ---------- */

async function ensureTickAlarm() {
  const existing = (await chrome.alarms.getAll()).some((a) => a.name === TICK_ALARM);
  if (!existing) chrome.alarms.create(TICK_ALARM, { periodInMinutes: 1 });
}

async function init(reason) {
  await ensureTickAlarm();
  await writeLog([makeEntry({ level: 'INFO', stage: 'FETCH', message: `Запуск оновлення (${reason})` })]);
  await refresh(reason);
  await onTick();
}

chrome.runtime.onInstalled.addListener(() => init('installed')); // В1.1: при встановленні
chrome.runtime.onStartup.addListener(() => init('startup')); // В1.1: при запуску Chrome

// service worker міг бути зупинений і перезапущений без onStartup — мітка не повинна застрягати
ensureTickAlarm().then(() => updateBadge()).catch(() => {});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'refresh') { // В1.2: «Оновити зараз» з вікна розширення
    refresh('popup').then(() => sendResponse({ ok: true })).catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }
  if (msg?.type === 'play-test-sounds') { // В3.19: «Прослухати звуки» з вікна розширення
    playSoundById('test').then(() => sendResponse({ ok: true })).catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }
  return false;
});

chrome.notifications.onClicked.addListener(async () => { // В3.14: відкрити сайт обленерго
  await chrome.tabs.create({ url: SITE_URL });
});
