// Тести логіки спрацювання сигналів: запізнення, пробудження (В3.15–В3.16, випадок 10)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleNotifyFire, nextRetryDelayMin } from '../src/plan.js';
import { validateData } from '../src/validate.js';
import { QUEUE } from '../src/schedule.js';
import { controlResponses, T } from './helpers.js';

function controlDays() {
  const v = validateData({ responses: controlResponses(), now: new Date(T(9, 0)), queueName: QUEUE.name, expectedQueueId: QUEUE.expectedId });
  return v.data.days;
}

const moment0700 = {
  at: T(9, 7, 0),
  events: [
    { offset: 0, zone: 'yellow', boundaryMin: 420, boundaryEpoch: T(9, 7, 0), date: '2026-11-09' },
    { offset: 30, zone: 'red', boundaryMin: 450, boundaryEpoch: T(9, 7, 30), date: '2026-11-09' },
  ],
};

test('Сигнал вчасно: об’єднаний момент надсилається як «зараз» (В3.4)', () => {
  const r = handleNotifyFire({ moment: moment0700, firedAt: T(9, 7, 0, 10), days: controlDays(), notifiedZone: 'green' });
  assert.equal(r.sends.length, 1);
  assert.equal(r.sends[0].kind, 'now');
  assert.equal(r.sends[0].zone, 'yellow');
  assert.equal(r.sends[0].offset, 0, 'момент зміни: зсув 0 (для вибору звуку)');
  assert.equal(r.sends[0].title, 'Черга 2.1 · зараз: жовта зона');
  assert.equal(r.sends[0].message, 'До 07:30 — електропостачання можливе. Далі: червона зона, заплановане відключення.');
  assert.equal(r.newNotifiedZone, 'yellow');
});

test('Сигнал вчасно: попередження T-30', () => {
  const m = { at: T(9, 6, 30), events: [{ offset: 30, zone: 'yellow', boundaryMin: 420, boundaryEpoch: T(9, 7, 0), date: '2026-11-09' }] };
  const r = handleNotifyFire({ moment: m, firedAt: T(9, 6, 30, 5), days: controlDays(), notifiedZone: 'green' });
  assert.equal(r.sends[0].kind, 'warn');
  assert.equal(r.sends[0].offset, 30, 'зсув збережено у сповіщенні (для вибору звуку)');
  assert.equal(r.sends[0].title, 'Черга 2.1 · через 30 хв: жовта зона');
  assert.equal(r.newNotifiedZone, null); // попередження не оновлює останню зону
});

test('Випадок 10: сигнал на 40 хв пізніше — одне сповіщення про поточну зону', () => {
  const r = handleNotifyFire({ moment: moment0700, firedAt: T(9, 7, 40), days: controlDays(), notifiedZone: 'green' });
  assert.equal(r.sends.length, 1);
  assert.equal(r.sends[0].kind, 'reconcile');
  assert.equal(r.sends[0].offset, 0, 'після пробудження: формат моменту зміни');
  assert.equal(r.sends[0].zone, 'red'); // о 07:40 уже червона
  assert.equal(r.sends[0].title, 'Черга 2.1 · зараз: червона зона');
  assert.equal(r.sends[0].message, 'До 10:00 — заплановане відключення. Далі: жовта зона, електропостачання можливе.');
  assert.equal(r.newNotifiedZone, 'red');
});

test('Пізно, але зона та сама — сповіщення не надсилається (В3.15)', () => {
  const r = handleNotifyFire({ moment: moment0700, firedAt: T(9, 7, 40), days: controlDays(), notifiedZone: 'red' });
  assert.equal(r.sends.length, 0);
  assert.equal(r.newNotifiedZone, null);
});

test('Пізно, але в об’єднаному моменті є попередження про майбутню зміну — воно надсилається', () => {
  // заплановано 07:00 (T-0 жовта@07:00 + T-30 червона@07:30), спрацювало 07:05
  const r = handleNotifyFire({ moment: moment0700, firedAt: T(9, 7, 5), days: controlDays(), notifiedZone: 'green' });
  // обидві зміни вже відбулися (07:00 і 07:30 > 07:05? ні: 07:30 у майбутньому)
  assert.equal(r.sends.length, 2); // reconcile про жовту + попередження про червону о 07:30
  assert.equal(r.sends[0].kind, 'reconcile');
  assert.equal(r.sends[1].kind, 'warn');
  assert.equal(r.sends[1].offset, 30, 'попередження про червону о 07:30 — зсув 30');
  assert.equal(r.sends[1].zone, 'red');
  assert.ok(r.sends[1].title.includes('червона зона'));
  assert.equal(r.newNotifiedZone, 'yellow'); // reconcile зафіксував жовту як останню оголошену
});

test('Вчасний T-0 оновлює останню оголошену зону', () => {
  const m = { at: T(9, 7, 30), events: [{ offset: 0, zone: 'red', boundaryMin: 450, boundaryEpoch: T(9, 7, 30), date: '2026-11-09' }] };
  const r = handleNotifyFire({ moment: m, firedAt: T(9, 7, 30, 30), days: controlDays(), notifiedZone: 'yellow' });
  assert.equal(r.sends[0].kind, 'now');
  assert.equal(r.newNotifiedZone, 'red');
});

test('В1.4: повтори через 5 і 15 хвилин, далі раз на годину', () => {
  assert.equal(nextRetryDelayMin(1), 5);
  assert.equal(nextRetryDelayMin(2), 15);
  assert.equal(nextRetryDelayMin(3), 60);
  assert.equal(nextRetryDelayMin(7), 60);
});
