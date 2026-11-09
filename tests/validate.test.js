// Тести перевірок даних П1–П12 (вимога В2) на контрольних даних fixtures
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateData } from '../src/validate.js';
import { QUEUE } from '../src/schedule.js';
import { loadControl, controlResponses, responsesFrom, T } from './helpers.js';

const NOW = T(9, 12, 0); // 9 листопада 2026, 12:00 за Києвом
const V = (responses, now = NOW) =>
  validateData({ responses, now: new Date(now), queueName: QUEUE.name, expectedQueueId: QUEUE.expectedId });

const levels = (v, code) => v.checks.filter((c) => c.code === code).map((c) => c.level);
const worst = (arr) => (arr.includes('error') ? 'error' : arr.includes('warn') ? 'warn' : arr[0] ?? 'none');

test('Контрольний день: усі перевірки проходять, помилок і попереджень немає', () => {
  const v = V(controlResponses());
  assert.equal(v.ok, true);
  assert.equal(worst(levels(v, 'П1')), 'pass');
  assert.equal(worst(levels(v, 'П2')), 'pass');
  assert.equal(worst(levels(v, 'П3')), 'pass');
  assert.equal(worst(levels(v, 'П4')), 'pass');
  assert.equal(worst(levels(v, 'П5')), 'pass');
  assert.equal(worst(levels(v, 'П6')), 'pass');
  assert.equal(worst(levels(v, 'П7')), 'pass');
  assert.equal(worst(levels(v, 'П8')), 'pass');
  assert.equal(worst(levels(v, 'П9')), 'pass');
  assert.equal(worst(levels(v, 'П10')), 'pass');
  assert.equal(worst(levels(v, 'П11')), 'pass');
  const noBad = v.checks.every((c) => c.level === 'pass' || c.level === 'info');
  assert.ok(noBad, JSON.stringify(v.checks.filter((c) => c.level === 'warn' || c.level === 'error')));
});

test('Контрольний день: знайдено чергу 2.1 з номером 16 і дату 2026-11-09', () => {
  const v = V(controlResponses());
  assert.equal(v.data.queueId, 16);
  assert.deepEqual(Object.keys(v.data.days), ['2026-11-09']);
});

test('П12: інформація про кількість записів черги 2.1 і графік на завтра', () => {
  const v = V(controlResponses());
  const info = v.checks.filter((c) => c.code === 'П12');
  assert.ok(info.length >= 2);
  assert.ok(info.some((c) => c.message.includes('2026-11-09') && c.message.includes('14')));
  assert.ok(info.some((c) => c.message.includes('завтра') && c.message.includes('немає')));
});

test('П1: код відповіді не 200 — помилка', () => {
  const r = controlResponses();
  r.schedules = { ...r.schedules, status: 502, bodyText: 'Bad gateway' };
  const v = V(r);
  assert.equal(v.ok, false);
  assert.equal(worst(levels(v, 'П1')), 'error');
  assert.equal(v.data, null); // дані не замінюють збережені
});

test('П1: мережева помилка — помилка з текстом', () => {
  const r = controlResponses();
  r.timeSeries = { url: 'u1', status: null, bodyText: null, durationMs: 5, error: "fetch failed" };
  const v = V(r);
  assert.equal(v.ok, false);
  assert.equal(worst(levels(v, 'П1')), 'error');
});

test('П2: тіло не є JSON — помилка, уривок тіла збережено (випадок 6)', () => {
  const r = controlResponses();
  r.queues = { url: 'u2', status: 200, bodyText: '<html><body>502 Bad Gateway</body></html>', durationMs: 5, error: null };
  const v = V(r);
  assert.equal(v.ok, false);
  const err = v.checks.find((c) => c.code === 'П2' && c.level === 'error');
  assert.ok(err);
  assert.ok(err.details.bodyExcerpt.includes('502 Bad Gateway'));
  assert.ok(err.details.bodyExcerpt.length <= 2000);
  assert.equal(v.data, null);
});

test('П3: 47 проміжків замість 48 — помилка (випадок 7)', () => {
  const c = loadControl();
  const r = responsesFrom({ ...c, timeSeries: c.timeSeries.slice(0, 47) });
  const v = V(r);
  assert.equal(v.ok, false);
  assert.equal(worst(levels(v, 'П3')), 'error');
});

test('П3: розрив між проміжками — помилка', () => {
  const c = loadControl();
  const ts = c.timeSeries.map((x) => ({ ...x }));
  ts[10].start = '06:00:00'; // розрив після 05:00–05:30
  const v = V(responsesFrom({ ...c, timeSeries: ts }));
  assert.equal(v.ok, false);
  assert.equal(worst(levels(v, 'П3')), 'error');
});

test('П4: черги 2.1 немає — помилка, дані не замінюються (випадок 4)', () => {
  const c = loadControl();
  const v = V(responsesFrom({ ...c, queues: c.queues.filter((q) => q.name !== '2.1') }));
  assert.equal(v.ok, false);
  assert.equal(worst(levels(v, 'П4')), 'error');
  assert.equal(v.data, null);
});

test('П4: черга 2.1 двічі — помилка', () => {
  const c = loadControl();
  const dup = [...c.queues, { ...c.queues.find((q) => q.name === '2.1'), id: 99 }];
  const v = V(responsesFrom({ ...c, queues: dup }));
  assert.equal(v.ok, false);
  assert.equal(worst(levels(v, 'П4')), 'error');
});

test('П5: номер черги інший — попередження, використано знайдений номер (випадок 5)', () => {
  const c = loadControl();
  const qs = c.queues.map((q) => (q.name === '2.1' ? { ...q, id: 116 } : q));
  const sch = c.schedules.map((s) => ({
    ...s,
    series: s.series.map((e) => (e.outage_queue_id === 16 ? { ...e, outage_queue_id: 116 } : (e.outage_queue_id === 15 ? { ...e, outage_queue_id: 15 } : e))),
  }));
  const v = V(responsesFrom({ ...c, queues: qs, schedules: sch }));
  assert.equal(v.ok, true); // попередження не блокує збереження
  const warn = v.checks.find((c2) => c2.code === 'П5');
  assert.equal(warn.level, 'warn');
  assert.equal(warn.got, '116');
  assert.equal(v.data.queueId, 116);
  assert.equal(v.data.days['2026-11-09'].slots.filter((t) => t !== 'ENABLE').length, 14);
});

test('П6: series без цілого time_series_id — помилка', () => {
  const c = loadControl();
  const sch = c.schedules.map((s) => ({ ...s, series: [...s.series, { outage_queue_id: 16, time_series_id: 1.5, type: 'OFF' }] }));
  const v = V(responsesFrom({ ...c, schedules: sch }));
  assert.equal(v.ok, false);
  assert.equal(worst(levels(v, 'П6')), 'error');
});

test('П6: schedule без from — помилка', () => {
  const c = loadControl();
  const sch = [{ to: '2026-11-09T21:59:00Z', series: [] }, ...c.schedules];
  const v = V(responsesFrom({ ...c, schedules: sch }));
  assert.equal(v.ok, false);
  assert.equal(worst(levels(v, 'П6')), 'error');
});

test('П7: from не опівночі за Києвом — попередження, дата все одно за правилом 2.1', () => {
  const c = loadControl();
  const sch = c.schedules.map((s) => ({ ...s, from: '2026-11-08T23:00:00.000000Z' })); // 01:00 за Києвом
  const v = V(responsesFrom({ ...c, schedules: sch }));
  assert.equal(v.ok, true);
  assert.equal(worst(levels(v, 'П7')), 'warn');
  assert.deepEqual(Object.keys(v.data.days), ['2026-11-09']);
});

test('П8: невідомий time_series_id — запис відкидається з попередженням', () => {
  const c = loadControl();
  const sch = c.schedules.map((s) => ({ ...s, series: [...s.series, { outage_queue_id: 16, time_series_id: 999, type: 'OFF' }] }));
  const v = V(responsesFrom({ ...c, schedules: sch }));
  assert.equal(v.ok, true);
  assert.equal(worst(levels(v, 'П8')), 'warn');
  assert.equal(v.data.days['2026-11-09'].slots.filter((t) => t !== 'ENABLE').length, 14); // запис відкинуто
});

test('П9: невідома черга — записи відкидаються з попередженням, черга 2.1 не страждає', () => {
  const c = loadControl();
  const sch = c.schedules.map((s) => ({
    ...s,
    series: [
      ...s.series,
      { outage_queue_id: 999, time_series_id: 1, type: 'OFF' },
      { outage_queue_id: 998, time_series_id: 2, type: 'PROBABLY_OFF' },
    ],
  }));
  const v = V(responsesFrom({ ...c, schedules: sch }));
  assert.equal(v.ok, true);
  assert.equal(levels(v, 'П9').filter((l) => l === 'warn').length, 2);
  assert.equal(v.data.days['2026-11-09'].slots.filter((t) => t !== 'ENABLE').length, 14);
});

test('П10: невідомий тип — жовта зона і попередження зі значенням (випадок 2)', () => {
  const c = loadControl();
  const sch = c.schedules.map((s) => ({ ...s, series: [...s.series, { outage_queue_id: 16, time_series_id: 10, type: 'MAYBE_OFF' }] }));
  const v = V(responsesFrom({ ...c, schedules: sch }));
  assert.equal(v.ok, true);
  const warn = v.checks.find((c2) => c2.code === 'П10');
  assert.equal(warn.level, 'warn');
  assert.equal(warn.got, 'MAYBE_OFF');
  const day = v.data.days['2026-11-09'];
  assert.equal(day.slots[9], 'MAYBE_OFF');
  assert.deepEqual(day.unknownTypes, ['MAYBE_OFF']);
});

test('П11: немає графіка на сьогодні — попередження (випадок 3)', () => {
  const v = V(controlResponses(), T(10, 12, 0)); // «сьогодні» вже 10 листопада
  assert.equal(v.ok, true);
  assert.equal(worst(levels(v, 'П11')), 'warn');
  assert.equal(v.data.days['2026-11-10'], undefined);
});

test('П11: порожній масив графіків — попередження', () => {
  const c = loadControl();
  const v = V(responsesFrom({ ...c, schedules: [] }));
  assert.equal(v.ok, true);
  assert.equal(worst(levels(v, 'П11')), 'warn');
  assert.deepEqual(v.data.days, {});
});
