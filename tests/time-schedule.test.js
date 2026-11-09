// Тести київського часу, побудови станів і відрізків (правила PRD 2.1–2.3)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  kyivToEpoch, kyivDateString, kyivParts, minuteOfDay, addDays, fmtHM, fmtDM,
  QUEUE, zoneOfType, dateOfSchedule, buildDaySlots, mergeIntervals, currentIntervalAt,
} from '../src/schedule.js';
import { loadControl } from './helpers.js';

test('Kyiv: узимку UTC+2 (9 листопада 2026)', () => {
  assert.equal(kyivToEpoch({ year: 2026, month: 11, day: 9, hour: 0, minute: 0 }), Date.UTC(2026, 10, 8, 22, 0, 0));
});

test('Kyiv: улітку UTC+3 (1 липня 2026)', () => {
  assert.equal(kyivToEpoch({ year: 2026, month: 7, day: 1, hour: 0, minute: 0 }), Date.UTC(2026, 5, 30, 21, 0, 0));
});

test('Kyiv: зворотне перетворення епохи в дату/час', () => {
  const ts = Date.UTC(2026, 10, 8, 22, 0, 0); // 2026-11-09 00:00 за Києвом
  assert.equal(kyivDateString(new Date(ts)), '2026-11-09');
  const p = kyivParts(new Date(ts));
  assert.deepEqual({ ...p }, { year: 2026, month: 11, day: 9, hour: 0, minute: 0, second: 0 });
  assert.equal(Math.round(minuteOfDay(new Date(Date.UTC(2026, 10, 9, 8, 15, 0)))), 10 * 60 + 15);
});

test('Довідкові функції дат', () => {
  assert.equal(addDays('2026-11-09', 1), '2026-11-10');
  assert.equal(addDays('2026-10-31', 1), '2026-11-01');
  assert.equal(fmtHM(0), '00:00');
  assert.equal(fmtHM(450), '07:30');
  assert.equal(fmtHM(1440), '24:00');
  assert.equal(fmtDM('2026-11-09'), '09.11');
});

test('Еталон черги — константи в одному місці (розділ 2.4)', () => {
  assert.equal(QUEUE.name, '2.1');
  assert.equal(QUEUE.expectedId, 16);
});

test('Відповідність станів і зон (розділ 2.3)', () => {
  assert.equal(zoneOfType('OFF'), 'red');
  assert.equal(zoneOfType('SURE_OFF'), 'red');
  assert.equal(zoneOfType('PROBABLY_OFF'), 'yellow');
  assert.equal(zoneOfType('ENABLE'), 'green');
  assert.equal(zoneOfType('WHATEVER'), 'yellow'); // невідомий тип → жовта
});

test('Дата графіка — дата from за Києвом (правило 2.1)', () => {
  assert.equal(dateOfSchedule({ from: '2026-11-08T22:00:00.000000Z', to: '2026-11-09T21:59:00.000000Z' }), '2026-11-09');
});

test('Контрольний день: стани 48 проміжків черги 2.1', () => {
  const c = loadControl();
  const tsIdToSlot = new Map(c.timeSeries.map((r, i) => [r.id, i]));
  const { slots, unknownTypes } = buildDaySlots({ schedulesForDate: c.schedules, queueId: 16, tsIdToSlot });
  assert.equal(slots.length, 48);
  assert.deepEqual(unknownTypes, []);
  // з control-прикладу: 14 записів для черги 2.1
  assert.equal(slots.filter((t) => t !== 'ENABLE').length, 14);
  assert.equal(slots[14], 'PROBABLY_OFF'); // 07:00–07:30
  for (let s = 15; s <= 19; s++) assert.equal(slots[s], 'OFF', `slot ${s}`); // 07:30–10:00
  assert.equal(slots[20], 'PROBABLY_OFF'); // 10:00–10:30
  assert.equal(slots[28], 'PROBABLY_OFF'); // 14:00–14:30
  for (let s = 29; s <= 33; s++) assert.equal(slots[s], 'OFF', `slot ${s}`); // 14:30–17:00
  assert.equal(slots[34], 'PROBABLY_OFF'); // 17:00–17:30
  assert.equal(slots[47], 'ENABLE');
});

test('Контрольний день: відрізки збігаються з fixtures (таблиця розділу 5)', () => {
  const c = loadControl();
  const tsIdToSlot = new Map(c.timeSeries.map((r, i) => [r.id, i]));
  const { slots } = buildDaySlots({ schedulesForDate: c.schedules, queueId: 16, tsIdToSlot });
  const ivs = mergeIntervals(slots);
  const got = ivs.map((iv) => ({ start: fmtHM(iv.startMin), end: fmtHM(iv.endMin), zone: iv.zone, types: iv.types }));
  assert.deepEqual(got, c.expected.days['2026-11-09'].intervals);
});

test('Правило SURE_OFF: запис після SURE_OFF не змінює стан (випадок 1)', () => {
  const tsIdToSlot = new Map([[1, 0]]);
  const mk = (type) => [{ series: [
    { outage_queue_id: 16, time_series_id: 1, type: 'OFF' },
    { outage_queue_id: 16, time_series_id: 1, type: 'SURE_OFF' },
    { outage_queue_id: 16, time_series_id: 1, type: 'OFF' }, // ігнорується
  ] }];
  const { slots } = buildDaySlots({ schedulesForDate: mk(), queueId: 16, tsIdToSlot });
  assert.equal(slots[0], 'SURE_OFF');
  const [iv] = mergeIntervals(slots);
  assert.equal(iv.hasSureOff, true);
  assert.deepEqual(iv.types, ['SURE_OFF']); // проміжний OFF перезаписано, залишилось SURE_OFF
});

test('Правило порядку записів: останній запис перемагає (крім SURE_OFF)', () => {
  const tsIdToSlot = new Map([[1, 0]]);
  const sched = [{ series: [
    { outage_queue_id: 16, time_series_id: 1, type: 'OFF' },
    { outage_queue_id: 16, time_series_id: 1, type: 'PROBABLY_OFF' },
  ] }];
  const { slots } = buildDaySlots({ schedulesForDate: sched, queueId: 16, tsIdToSlot });
  assert.equal(slots[0], 'PROBABLY_OFF');
});

test('Кілька графіків на одну дату об’єднуються в порядку масиву (правило 2.1)', () => {
  const tsIdToSlot = new Map([[1, 0], [2, 1]]);
  const schedules = [
    { series: [{ outage_queue_id: 16, time_series_id: 1, type: 'OFF' }] },
    { series: [
      { outage_queue_id: 16, time_series_id: 1, type: 'SURE_OFF' }, // інший графік той самий день
      { outage_queue_id: 16, time_series_id: 2, type: 'OFF' },
    ] },
  ];
  const { slots } = buildDaySlots({ schedulesForDate: schedules, queueId: 16, tsIdToSlot });
  assert.equal(slots[0], 'SURE_OFF');
  assert.equal(slots[1], 'OFF');
});

test('Сусідні однакові зони зливаються; перехід OFF↔SURE_OFF не розділяє відрізок', () => {
  const slots = new Array(48).fill('ENABLE');
  slots[10] = 'OFF'; slots[11] = 'SURE_OFF'; slots[12] = 'OFF'; // один червоний відрізок 05:00–06:30
  const ivs = mergeIntervals(slots);
  const red = ivs.find((iv) => iv.zone === 'red');
  assert.equal(red.startMin, 300);
  assert.equal(red.endMin, 390);
  assert.equal(red.hasSureOff, true);
});

test('currentIntervalAt: поточний відрізок за часом', () => {
  const c = loadControl();
  const tsIdToSlot = new Map(c.timeSeries.map((r, i) => [r.id, i]));
  const { slots } = buildDaySlots({ schedulesForDate: c.schedules, queueId: 16, tsIdToSlot });
  const days = { '2026-11-09': { slots, unknownTypes: [] } };
  const at = (h, m) => kyivToEpoch({ year: 2026, month: 11, day: 9, hour: h, minute: m });
  assert.equal(currentIntervalAt(days, new Date(at(8, 0))).iv.zone, 'red');
  assert.equal(currentIntervalAt(days, new Date(at(10, 15))).iv.zone, 'yellow');
  assert.equal(currentIntervalAt(days, new Date(at(23, 59))).iv.zone, 'green');
  assert.equal(currentIntervalAt({}, new Date(at(8, 0))), null); // немає графіка на дату
});
