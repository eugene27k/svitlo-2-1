// Тести звуків сповіщень про зміну зони (В3.18–В3.20)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { soundForSend, SOUNDS, soundDurationMs } from '../src/sound.js';
import { planNotifications } from '../src/plan.js';
import { validateData } from '../src/validate.js';
import { QUEUE } from '../src/schedule.js';
import { controlResponses, T } from './helpers.js';

/* ---------- чиста логіка вибору звуку ---------- */

test('Звук для попередження T-15 і моменту зміни; T-30 — без звуку (В3.18)', () => {
  assert.equal(soundForSend({ kind: 'warn', offset: 30, zone: 'yellow' }), null, 'за 30 хв звуку немає');
  assert.equal(soundForSend({ kind: 'warn', offset: 15, zone: 'yellow' }), 'yellow');
  assert.equal(soundForSend({ kind: 'warn', offset: 15, zone: 'green' }), 'green');
  assert.equal(soundForSend({ kind: 'warn', offset: 15, zone: 'red' }), 'red');
  assert.equal(soundForSend({ kind: 'now', offset: 0, zone: 'red' }), 'red');
  assert.equal(soundForSend({ kind: 'now', offset: 0, zone: 'green' }), 'green');
  assert.equal(soundForSend({ kind: 'now', offset: 0, zone: 'yellow' }), 'yellow');
});

test('Сповіщення після пробудження — звук поточної зони (В3.20)', () => {
  assert.equal(soundForSend({ kind: 'reconcile', offset: 0, zone: 'red' }), 'red');
  assert.equal(soundForSend({ kind: 'reconcile', offset: 0, zone: 'green' }), 'green');
});

test('Без зони або невідомий тип — без звуку', () => {
  assert.equal(soundForSend({ kind: 'now', offset: 0, zone: 'none' }), null);
  assert.equal(soundForSend({ kind: 'warn', offset: 15, zone: 'none' }), null);
  assert.equal(soundForSend({ kind: 'other', offset: 0, zone: 'red' }), null);
  assert.equal(soundForSend(null), null);
});

test('Характер звуків за зонами (В3.18): приємний / нейтральний / тривожний', () => {
  assert.ok(SOUNDS.green.notes.length >= 3, 'зелений — акорд із кількох нот');
  assert.ok(SOUNDS.green.notes.every((n) => n.type === 'sine'), 'зелений — м’яка синусоїда');
  assert.equal(new Set(SOUNDS.yellow.notes.map((n) => n.freq)).size, 1, 'жовтий — однотонні гудки');
  assert.ok(new Set(SOUNDS.red.notes.map((n) => n.freq)).size >= 2, 'червоний — двотональний сигнал');
  assert.ok(SOUNDS.red.notes.length >= 4, 'червоний — кілька тривожних імпульсів');
});

test('Специфікації: частоти чутні, тривалості короткі, гучність безпечна', () => {
  for (const id of ['green', 'yellow', 'red', 'test']) {
    const notes = SOUNDS[id].notes;
    assert.ok(notes.length >= 1, `${id}: є ноти`);
    let end = 0;
    for (const n of notes) {
      assert.ok(n.freq >= 80 && n.freq <= 8000, `${id}: частота в чутному діапазоні`);
      assert.ok(n.dur > 0.03 && n.dur <= 0.5, `${id}: тривалість ноти розумна`);
      assert.ok(n.gain > 0 && n.gain <= 0.3, `${id}: гучність безпечна`);
      assert.ok(n.start >= 0, `${id}: початок не від’ємний`);
      end = Math.max(end, n.start + n.dur);
    }
    assert.ok(end <= 3, `${id}: звук короткий`);
    assert.equal(soundDurationMs(id), Math.round(end * 1000), `${id}: тривалість з нот`);
  }
});

test('«test» містить усі три зони підряд', () => {
  assert.ok(soundDurationMs('test') > soundDurationMs('green'), 'тест довший за один звук');
});

/* ---------- інтеграція з фоновим скриптом ---------- */

function controlDays() {
  const v = validateData({ responses: controlResponses(), now: new Date(T(9, 0)), queueName: QUEUE.name, expectedQueueId: QUEUE.expectedId });
  return v.data.days;
}

function makeChrome() {
  const store = new Map();
  const alarms = new Map();
  const notifications = [];
  const sentMessages = [];
  const offscreenDocs = [];
  let offscreenOpen = false;
  const listeners = { alarm: [], message: [] };
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
      onClicked: { addListener: () => {} },
    },
    runtime: {
      getURL: (p) => `chrome-extension://test/${p}`,
      sendMessage: async (msg) => { sentMessages.push(msg); },
      onInstalled: { addListener: () => {} },
      onStartup: { addListener: () => {} },
      onMessage: { addListener: (fn) => listeners.message.push(fn) },
    },
    offscreen: {
      hasDocument: async () => offscreenOpen,
      createDocument: async (opts) => { offscreenDocs.push(opts); offscreenOpen = true; },
    },
    action: {
      setBadgeText: async () => {},
      setBadgeBackgroundColor: async () => {},
    },
    tabs: { create: async () => {} },
  };
  return { chrome, store, notifications, sentMessages, offscreenDocs, listeners };
}

test('інтеграція: T-30 без звуку, T-15 і момент зміни зі звуком, після пробудження зі звуком', async () => {
  const { chrome, store, notifications, sentMessages, offscreenDocs, listeners } = makeChrome();
  const RealDate = globalThis.Date;
  let nowMs = T(9, 0);
  class FakeDate extends RealDate {
    constructor(...args) { if (args.length === 0) super(nowMs); else super(...args); }
    static now() { return nowMs; }
  }
  globalThis.chrome = chrome;
  globalThis.Date = FakeDate;

  const plays = () => sentMessages.filter((m) => m?.type === 'play-sound');

  try {
    const days = controlDays();
    const { moments } = planNotifications({ days, now: new Date(T(9, 0)) });
    const only = (offset, boundaryMin) => moments.find(
      (m) => m.events.length > 0 && m.events.every((e) => e.offset === offset) && m.events[0].boundaryMin === boundaryMin,
    );
    const m30 = only(30, 420); // за 30 хв до жовтої 07:00
    const m15 = only(15, 420); // за 15 хв до жовтої 07:00
    const m0 = moments.find((m) => m.events.some((e) => e.offset === 0 && e.boundaryMin === 420)); // 07:00 (об'єднаний)
    assert.ok(m30 && m15 && m0, 'контрольні моменти знайдені');

    store.set('svitlo:state', {
      version: 1,
      queue: { name: QUEUE.name, expectedId: QUEUE.expectedId, foundId: 16, verifiedAt: T(9, 0) },
      days,
      checks: [],
      notifiedZone: null,
      plannedMoments: { 'svitlo-notify-30': m30, 'svitlo-notify-15': m15, 'svitlo-notify-0': m0 },
    });
    await import('../src/background.js');

    // T-30: сповіщення є, звуку немає
    nowMs = m30.at + 100;
    await listeners.alarm[0]({ name: 'svitlo-notify-30' });
    assert.equal(notifications.length, 1);
    assert.ok(notifications[0].title.includes('через 30 хв'));
    assert.equal(plays().length, 0, 'за 30 хв звук не грає');

    // T-15: сповіщення + звук зони, offscreen-документ створено
    nowMs = m15.at + 100;
    await listeners.alarm[0]({ name: 'svitlo-notify-15' });
    assert.equal(notifications.length, 2);
    assert.ok(notifications[1].title.includes('через 15 хв'));
    assert.equal(plays().length, 1);
    assert.equal(plays()[0].sound, 'yellow', 'звук жовтої зони');
    assert.equal(offscreenDocs.length, 1, 'offscreen-документ створено один раз');
    assert.deepEqual(offscreenDocs[0].reasons, ['AUDIO_PLAYBACK']);

    // T-0 (об'єднаний момент): «зараз жовта» + звук
    nowMs = m0.at + 100;
    await listeners.alarm[0]({ name: 'svitlo-notify-0' });
    assert.equal(notifications.length, 3);
    assert.ok(notifications[2].title.startsWith('Черга 2.1 · зараз: жовта зона'));
    assert.equal(plays().length, 2);
    assert.equal(plays()[1].sound, 'yellow');

    // після пробудження (щохвилинний сигнал): зона змінилася на червону → сповіщення + звук
    nowMs = T(9, 8, 0);
    await listeners.alarm[0]({ name: 'svitlo-tick' });
    assert.equal(notifications.length, 4);
    assert.ok(notifications[3].title.startsWith('Черга 2.1 · зараз: червона зона'));
    assert.equal(plays().length, 3);
    assert.equal(plays()[2].sound, 'red', 'після пробудження — тривожний звук');
    assert.equal(offscreenDocs.length, 1, 'документ не створюється заново');

    // «Прослухати звуки» з вікна розширення
    const resp = await new Promise((res) => listeners.message[0]({ type: 'play-test-sounds' }, null, res));
    assert.deepEqual(resp, { ok: true });
    assert.equal(plays().length, 4);
    assert.equal(plays()[3].sound, 'test', 'тестові звуки трьох зон');
  } finally {
    globalThis.Date = RealDate;
    delete globalThis.chrome;
  }
});
