// Тести розрахунку моментів сповіщень і їх об'єднання (вимога В3)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planNotifications } from '../src/plan.js';
import { validateData } from '../src/validate.js';
import { QUEUE, mergeIntervals } from '../src/schedule.js';
import { loadControl, controlResponses, eventToString, hm, T } from './helpers.js';

function controlDays() {
  const v = validateData({ responses: controlResponses(), now: new Date(T(9, 0)), queueName: QUEUE.name, expectedQueueId: QUEUE.expectedId });
  assert.equal(v.ok, true);
  return v.data.days;
}

test('Контрольний день: 20 моментів сповіщень, 4 об’єднаних — збіг із fixtures (В3.17)', () => {
  const plan = planNotifications({ days: controlDays(), now: new Date(T(9, 0, 0)) });
  const expected = loadControl().expected.days['2026-11-09'].notificationMoments;
  const got = plan.moments.map((m) => ({ at: hm(m.at), events: m.events.map(eventToString) }));
  assert.deepEqual(got, expected);
  assert.equal(plan.moments.length, 20);
  assert.equal(plan.moments.filter((m) => m.events.length > 1).length, 4);
});

test('Об’єднаний момент: заголовок від сповіщення про момент зміни (В3.4)', () => {
  const plan = planNotifications({ days: controlDays(), now: new Date(T(9, 0, 0)) });
  const m = plan.moments.find((x) => hm(x.at) === '07:00');
  assert.deepEqual(m.events.map((e) => e.offset), [0, 30]); // T-0 перший
});

test('Моменти лише в майбутньому: о 08:00 раніш моменти не плануються', () => {
  const plan = planNotifications({ days: controlDays(), now: new Date(T(9, 8, 0)) });
  const ats = plan.moments.map((m) => hm(m.at));
  assert.deepEqual(ats, ['09:30', '09:45', '10:00', '10:15', '10:30', '13:30', '13:45', '14:00', '14:15', '14:30', '16:30', '16:45', '17:00', '17:15', '17:30']);
});

test('Немає графіка на завтра — перехід опівночі не планується (В3.6)', () => {
  const plan = planNotifications({ days: controlDays(), now: new Date(T(9, 20, 0)) });
  assert.equal(plan.moments.length, 0); // після 17:30 змін нема і завтра нема
});

test('Випадок 8: завтра червоний перший при червоному останньому сьогодні — опівночі зміни нема', () => {
  const days = controlDays();
  const tm = new Array(48).fill('ENABLE');
  for (let s = 0; s < 4; s++) tm[s] = 'OFF'; // завтра 00:00–02:00 червона
  // сьогодні останній відрізок 17:30–24:00 зелений → зробимо його червоним
  days['2026-11-09'].slots.fill('OFF', 35, 48);
  days['2026-11-10'] = { slots: tm, unknownTypes: [] };
  const plan = planNotifications({ days, now: new Date(T(9, 20, 0)) });
  const midnight = plan.moments.filter((m) => hm(m.at) === '23:30' || hm(m.at) === '23:45' || hm(m.at) === '00:00');
  assert.deepEqual(midnight, []);
  // але о 00:00 має бути T-0? Ні: зміни опівночі нема, отже моментів немає взагалі
  assert.equal(plan.moments.find((m) => m.events.some((e) => e.boundaryMin === 1440)), undefined);
});

test('Опівніччя зі зміною зони планується, якщо графік на завтра є і зони різні', () => {
  const days = controlDays();
  const tm = new Array(48).fill('ENABLE');
  tm[0] = 'OFF'; // завтра з 00:00 червона, сьогодні до 24:00 зелена
  days['2026-11-10'] = { slots: tm, unknownTypes: [] };
  const plan = planNotifications({ days, now: new Date(T(9, 20, 0)) });
  const midnightEvents = plan.moments.flatMap((m) => m.events).filter((e) => e.boundaryMin === 1440);
  assert.deepEqual(midnightEvents.map((e) => `${e.offset}:${e.zone}`).sort(), ['0:red', '15:red', '30:red']);
  // T-30 о 23:30, T-15 о 23:45, T-0 о 00:00 (00:00 наступної доби — за межами сьогоднішніх рядків)
  const ats = plan.moments.map((m) => hm(m.at));
  assert.ok(ats.includes('23:30') && ats.includes('23:45'));
});

test('Опівночі в межах того самого моменту доби не ламає сортування моментів', () => {
  const days = controlDays();
  const tm = new Array(48).fill('ENABLE');
  tm[0] = 'OFF'; // завтра 00:00–00:30 червона, далі зелена
  days['2026-11-10'] = { slots: tm, unknownTypes: [] };
  const plan = planNotifications({ days, now: new Date(T(9, 20, 0)) });
  for (let i = 1; i < plan.moments.length; i++) assert.ok(plan.moments[i].at > plan.moments[i - 1].at);
  // момент опівночі: T-0 переходу в червону + T-30 повернення в зелену о 00:30
  const midnight = plan.moments.find((m) => hm(m.at) === '00:00');
  assert.equal(midnight.events[0].offset, 0);
  assert.equal(midnight.events[0].zone, 'red');
  assert.deepEqual(midnight.events.map((e) => e.offset), [0, 30]);
  // останній момент — T-0 повернення в зелену о 00:30 завтра
  const last = plan.moments[plan.moments.length - 1];
  assert.equal(hm(last.at), '00:30');
  assert.equal(last.events[0].zone, 'green');
});

test('mergeIntervals: повний червоний день — один відрізок', () => {
  const ivs = mergeIntervals(new Array(48).fill('OFF'));
  assert.equal(ivs.length, 1);
  assert.equal(ivs[0].startMin, 0);
  assert.equal(ivs[0].endMin, 1440);
});
