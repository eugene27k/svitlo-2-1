// Тести порівняння графіків (вимога В5)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffGraphs, graphChangeNotification, tomorrowAppearedNotification } from '../src/diff.js';
import { validateData } from '../src/validate.js';
import { QUEUE } from '../src/schedule.js';
import { controlResponses, T } from './helpers.js';

function controlDays() {
  const v = validateData({ responses: controlResponses(), now: new Date(T(9, 0)), queueName: QUEUE.name, expectedQueueId: QUEUE.expectedId });
  return v.data.days;
}

const NOW = T(9, 8, 0); // 08:00 за Києвом

test('Випадок 9: зміна майбутнього проміжку — сповіщення з правильним рядком', () => {
  const oldDays = controlDays();
  const slots = [...oldDays['2026-11-09'].slots];
  slots[30] = 'PROBABLY_OFF'; // 15:00–15:30 OFF → PROBABLY_OFF (майбутній)
  const newDays = { '2026-11-09': { slots, unknownTypes: [] } };
  const d = diffGraphs({ oldDays, newDays, now: new Date(NOW) });
  assert.equal(d.changed, true);
  assert.deepEqual(d.lines, ['09.11 15:00–15:30: червона зона → жовта зона']);
  const n = graphChangeNotification(d);
  assert.equal(n.title, 'Черга 2.1 · графік змінився');
  assert.equal(n.message, '09.11 15:00–15:30: червона зона → жовта зона');
});

test('Випадок 9: зміна минулого проміжку — без сповіщення', () => {
  const oldDays = controlDays();
  const slots = [...oldDays['2026-11-09'].slots];
  slots[5] = 'OFF'; // 02:30–03:00 (минулий)
  const d = diffGraphs({ oldDays, newDays: { '2026-11-09': { slots, unknownTypes: [] } }, now: new Date(NOW) });
  assert.equal(d.changed, false);
  assert.equal(graphChangeNotification(d), null);
});

test('Сусідні змінені проміжки з однаковою парою зон зливаються (В5.4)', () => {
  const oldDays = controlDays();
  const slots = [...oldDays['2026-11-09'].slots];
  slots[30] = 'PROBABLY_OFF';
  slots[31] = 'PROBABLY_OFF'; // 15:00–16:00 одним рядком
  const d = diffGraphs({ oldDays, newDays: { '2026-11-09': { slots, unknownTypes: [] } }, now: new Date(NOW) });
  assert.deepEqual(d.lines, ['09.11 15:00–16:00: червона зона → жовта зона']);
});

test('Випадок В5.5: OFF → SURE_OFF — «заплановане → актуальне відключення»', () => {
  const oldDays = controlDays();
  const slots = [...oldDays['2026-11-09'].slots];
  slots[16] = 'SURE_OFF'; // 08:00–08:30
  const d = diffGraphs({ oldDays, newDays: { '2026-11-09': { slots, unknownTypes: [] } }, now: new Date(NOW) });
  assert.deepEqual(d.lines, ['09.11 08:00–08:30: заплановане → актуальне відключення']);
});

test('SURE_OFF → OFF — «актуальне → заплановане відключення»', () => {
  const oldDays = controlDays();
  const slots = [...oldDays['2026-11-09'].slots];
  slots[16] = 'OFF';
  slots[17] = 'OFF';
  const oldSlots = [...slots];
  oldSlots[16] = 'SURE_OFF'; // було SURE_OFF 08:00–08:30, стало OFF → окремі рядки
  const d = diffGraphs({
    oldDays: { '2026-11-09': { slots: oldSlots, unknownTypes: [] } },
    newDays: { '2026-11-09': { slots, unknownTypes: [] } },
    now: new Date(NOW),
  });
  assert.deepEqual(d.lines, ['09.11 08:00–08:30: актуальне → заплановане відключення']);
});

test('Більше трьох змін — три рядки і «і ще N змін» (В5.4)', () => {
  const oldDays = controlDays();
  const slots = [...oldDays['2026-11-09'].slots];
  slots[21] = 'OFF'; slots[23] = 'OFF'; slots[25] = 'OFF'; slots[27] = 'OFF'; // 4 окремі зміни
  const d = diffGraphs({ oldDays, newDays: { '2026-11-09': { slots, unknownTypes: [] } }, now: new Date(NOW) });
  assert.equal(d.rows.length, 4);
  assert.equal(d.lines.length, 3);
  assert.equal(d.extraCount, 1);
  const n = graphChangeNotification(d);
  assert.ok(n.message.includes('і ще 1 змін'));
});

test('В5.6: графік на завтра з’явився вперше — сповіщення з відрізками', () => {
  const oldDays = controlDays();
  const tm = new Array(48).fill('ENABLE');
  for (let s = 15; s <= 19; s++) tm[s] = 'OFF'; // завтра 07:30–10:00 червона
  tm[14] = 'PROBABLY_OFF'; // 07:00–07:30 жовта
  const newDays = { ...oldDays, '2026-11-10': { slots: tm, unknownTypes: [] } };
  const d = diffGraphs({ oldDays, newDays, now: new Date(NOW) });
  assert.equal(d.tomorrowAppeared, true);
  assert.equal(d.tomorrowDate, '2026-11-10');
  const n = tomorrowAppearedNotification({ date: d.tomorrowDate, days: newDays });
  assert.equal(n.title, 'Черга 2.1 · з’явився графік на 10.11');
  assert.equal(n.message, 'Червона: 07:30–10:00. Жовта: 07:00–07:30.');
});

test('В5.6: тільки червоні відрізки — жовту частину пропущено; без відключень — свій текст', () => {
  const green = new Array(48).fill('ENABLE');
  const n2 = tomorrowAppearedNotification({ date: '2026-11-10', days: { '2026-11-10': { slots: green, unknownTypes: [] } } });
  assert.equal(n2.message, 'Відключень для черги 2.1 не заплановано.');
  const onlyRed = new Array(48).fill('ENABLE');
  onlyRed[0] = 'OFF';
  const n3 = tomorrowAppearedNotification({ date: '2026-11-10', days: { '2026-11-10': { slots: onlyRed, unknownTypes: [] } } });
  assert.equal(n3.message, 'Червона: 00:00–00:30.');
});

test('В5.8: після першого встановлення (немає старих даних) — жодних сповіщень про зміни', () => {
  const d = diffGraphs({ oldDays: null, newDays: controlDays(), now: new Date(NOW) });
  assert.equal(d.changed, false);
  assert.equal(d.tomorrowAppeared, false);
});

test('Зміни порівнюються окремо для кожної дати (В5.1)', () => {
  const oldDays = controlDays();
  const tm = new Array(48).fill('ENABLE');
  tm[10] = 'OFF';
  const oldWithTm = { ...oldDays, '2026-11-10': { slots: new Array(48).fill('ENABLE'), unknownTypes: [] } };
  const newDays = { ...oldDays, '2026-11-10': { slots: tm, unknownTypes: [] } };
  const d = diffGraphs({ oldDays: oldWithTm, newDays, now: new Date(NOW) });
  assert.deepEqual(d.lines, ['10.11 05:00–05:30: зелена зона → червона зона']);
});
