// Інтеграційний тест фонового скрипта: мок chrome.* і fetch із контрольними даними.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadFixture, T } from './helpers.js';

const FIXED = Date.UTC(2026, 10, 9, 10, 0, 0); // 9 листопада 2026, 12:00 за Києвом

function makeChrome() {
  const store = new Map();
  const alarms = new Map();
  const notifications = [];
  const listeners = { alarm: [], installed: [], startup: [], message: [], clicked: [] };
  const chrome = {
    storage: {
      local: {
        get: async (keys) => {
          const out = {};
          for (const k of [].concat(keys)) if (store.has(k)) out[k] = store.get(k);
          return out;
        },
        set: async (obj) => { for (const [k, v] of Object.entries(obj)) store.set(k, v); },
      },
    },
    alarms: {
      create: (name, info) => alarms.set(name, { name, ...info }),
      clear: async (name) => alarms.delete(name),
      getAll: async () => [...alarms.values()],
      onAlarm: { addListener: (fn) => listeners.alarm.push(fn) },
    },
    notifications: {
      create: async (opts) => notifications.push(opts),
      getPermissionLevel: (cb) => cb('granted'),
      onClicked: { addListener: (fn) => listeners.clicked.push(fn) },
    },
    runtime: {
      getURL: (p) => `chrome-extension://test/${p}`,
      sendMessage: async () => {},
      onInstalled: { addListener: (fn) => listeners.installed.push(fn) },
      onStartup: { addListener: (fn) => listeners.startup.push(fn) },
      onMessage: { addListener: (fn) => listeners.message.push(fn) },
    },
    action: {
      badge: null, badgeColor: null,
      setBadgeText: async (o) => { chrome.action.badge = o.text; },
      setBadgeBackgroundColor: async (o) => { chrome.action.badgeColor = o.color; },
    },
    tabs: { create: async () => {} },
  };
  return { chrome, store, alarms, notifications, listeners };
}

test('інтеграція: встановлення, оновлення, зміна графіка, збої (В1, В2, В5)', async () => {
  const { chrome, store, alarms, notifications, listeners } = makeChrome();
  const RealDate = globalThis.Date;
  const RealFetch = globalThis.fetch;
  class FakeDate extends RealDate {
    constructor(...args) { if (args.length === 0) super(FIXED); else super(...args); }
    static now() { return FIXED; }
  }
  globalThis.chrome = chrome;
  globalThis.Date = FakeDate;

  const tsBody = JSON.stringify(loadFixture('time-series.json'));
  const qBody = JSON.stringify(loadFixture('outage-queue-by-type-3.json'));
  const active = loadFixture('schedule-active-2026-11-09.json');
  const sBody = JSON.stringify(active);
  const serve = (body) => async (url) => ({
    status: 200,
    text: async () => (url.includes('time-series') ? tsBody : url.includes('by-type') ? qBody : body),
  });
  globalThis.fetch = serve(sBody);

  const popupRefresh = () => new Promise((res) => listeners.message[0]({ type: 'refresh' }, null, res));

  try {
    await import('../src/background.js');
    await listeners.installed[0](); // onInstalled → init → перше оновлення (В1.1)

    const state = store.get('svitlo:state');
    assert.equal(state.lastAttemptOk, true);
    assert.equal(state.queue.foundId, 16);
    assert.equal(state.days['2026-11-09'].slots.filter((t) => t !== 'ENABLE').length, 14);
    assert.equal(state.nextUpdateAt, FIXED + 60 * 60_000, 'наступне оновлення через годину');
    assert.equal(notifications.length, 0, 'після встановлення сповіщень про зміну графіка немає (В5.8)');
    assert.ok(alarms.has('svitlo-tick'), 'щохвилинний сигнал мітки');
    const notifyNames = [...alarms.keys()].filter((n) => n.startsWith('svitlo-notify-'));
    assert.ok(notifyNames.length > 0, 'сигнали сповіщень заплановані (В3.3)');
    assert.equal(typeof chrome.action.badge, 'string');
    assert.equal(chrome.action.badgeColor, '#1E8E3E', 'мітка: сталий колір зони (В4.1), моргання неактивне за 2 год до зміни (В4.11)');

    // сирі тіла успішної спроби збережено (В6.4)
    const raw = store.get('svitlo:raw');
    assert.ok(raw.success.timeSeries.includes('00:00:00'));
    // журнал ведеться (В6.1)
    const log = store.get('svitlo:log');
    assert.ok(log.length > 0 && log[0].time.includes('+02:00'));

    // друга успішна спроба: з'явився запис, що змінює майбутній проміжок 15:00–15:30 → сповіщення В5.3
    const sBody2 = JSON.stringify([{ ...active[0], series: [...active[0].series, { outage_queue_id: 16, time_series_id: 31, type: 'PROBABLY_OFF' }] }]);
    globalThis.fetch = serve(sBody2);
    await popupRefresh(); // «Оновити зараз» (В1.2)
    assert.ok(notifications.some((n) => n.title === 'Черга 2.1 · графік змінився'), 'сповіщення про зміну графіка');
    assert.ok(notifications.find((n) => n.title === 'Черга 2.1 · графік змінився').message.includes('15:00–15:30: червона зона → жовта зона'));
    assert.equal(store.get('svitlo:state').days['2026-11-09'].slots[30], 'PROBABLY_OFF');

    // три невдалі спроби поспіль: повтори 5/15 хв, потім година; сповіщення В2.15 один раз; дані не замінюються
    globalThis.fetch = async () => { throw new Error('сайт недоступний'); };
    await popupRefresh();
    assert.equal(alarms.get('svitlo-fetch').when, FIXED + 5 * 60_000, 'перший повтор через 5 хв (В1.4)');
    await popupRefresh();
    assert.equal(alarms.get('svitlo-fetch').when, FIXED + 15 * 60_000, 'другий повтор через 15 хв (В1.4)');
    await popupRefresh();
    assert.equal(alarms.get('svitlo-fetch').when, FIXED + 60 * 60_000, 'далі раз на годину (В1.4)');
    const st3 = store.get('svitlo:state');
    assert.equal(st3.consecutiveFailures, 3);
    assert.equal(st3.lastAttemptOk, false);
    assert.equal(st3.days['2026-11-09'].slots[30], 'PROBABLY_OFF', 'дані останнього успішного оновлення збережено (В2.13, В1.5)');
    const failNotes = notifications.filter((n) => n.title === 'Черга 2.1: не вдалося оновити графік');
    assert.equal(failNotes.length, 1, 'сповіщення про три збої — один раз (В2.15)');
    assert.ok(failNotes[0].message.includes('Останнє успішне оновлення:'));
    // сирі тіла невдалої спроби збережено окремо (В6.4)
    assert.ok(store.get('svitlo:raw').fail.savedAt > 0);

    // спрацювання запланованого сповіщення → надсилається (В3.2–В3.3)
    const withPayload = store.get('svitlo:state').plannedMoments;
    const someName = Object.keys(withPayload)[0];
    const beforeFire = notifications.length;
    await listeners.alarm[0]({ name: someName });
    assert.equal(notifications.length, beforeFire + 1, 'сигнал надіслав сповіщення');
    assert.ok(notifications[beforeFire].title.startsWith('Черга 2.1 · через'));
    assert.ok(store.get('svitlo:log').some((e) => e.stage === 'NOTIFY'));
  } finally {
    globalThis.Date = RealDate;
    globalThis.fetch = RealFetch;
    delete globalThis.chrome;
  }
});
