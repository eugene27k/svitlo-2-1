// Тести запитів (В1.3) і журналу (В6.1–В6.2)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchOne, fetchAll, URLS } from '../src/api.js';
import { isoKyiv, makeEntry, appendEntries, checkToEntries } from '../src/log.js';
import { T } from './helpers.js';

const okResponse = (body = '[]') => ({ status: 200, text: async () => body });

test('api: URL трьох адрес сайту (розділ 2)', () => {
  assert.equal(URLS.timeSeries, 'https://off.energy.mk.ua/api/schedule/time-series');
  assert.equal(URLS.queues, 'https://off.energy.mk.ua/api/outage-queue/by-type/3');
  assert.equal(URLS.schedules, 'https://off.energy.mk.ua/api/v2/schedule/active');
});

test('api: успішний запит повертає статус і тіло', async () => {
  const r = await fetchOne(URLS.queues, { fetchImpl: async () => okResponse('[1]') });
  assert.equal(r.status, 200);
  assert.equal(r.bodyText, '[1]');
  assert.equal(r.error, null);
  assert.equal(typeof r.durationMs, 'number');
});

test('api: не 200 — статус збережено для П1', async () => {
  const r = await fetchOne(URLS.schedules, { fetchImpl: async () => ({ status: 502, text: async () => 'Bad' }) });
  assert.equal(r.status, 502);
  assert.equal(r.error, null);
});

test('api: мережева помилка не кидає винятків', async () => {
  const r = await fetchOne(URLS.timeSeries, { fetchImpl: async () => { throw new Error('boom'); } });
  assert.equal(r.status, null);
  assert.equal(r.bodyText, null);
  assert.ok(r.error.includes('boom'));
});

test('api: запит без кешу (В1.3)', async () => {
  let gotOpts;
  await fetchOne(URLS.queues, { fetchImpl: async (_u, opts) => { gotOpts = opts; return okResponse(); } });
  assert.equal(gotOpts.cache, 'no-store');
});

test('api: fetchAll повертає всі три відповіді', async () => {
  const all = await fetchAll({ fetchImpl: async () => okResponse('{}') });
  assert.deepEqual(Object.keys(all), ['timeSeries', 'queues', 'schedules']);
  assert.ok(all.timeSeries.status === 200 && all.schedules.status === 200);
});

test('api: перевищення часу очікування — помилка з текстом про таймаут (В1.3)', async () => {
  const never = (_u, opts) => new Promise((_res, rej) => { opts.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))); });
  const r = await fetchOne(URLS.timeSeries, { timeoutMs: 60, fetchImpl: never });
  assert.equal(r.status, null);
  assert.ok(r.error.includes('час очікування'), r.error);
});

test('log: мітка часу ISO з київським зміщенням', () => {
  assert.equal(isoKyiv(new Date(Date.UTC(2026, 10, 8, 22, 0, 0))), '2026-11-09T00:00:00+02:00');
  assert.equal(isoKyiv(new Date(Date.UTC(2026, 5, 30, 21, 5, 9))), '2026-07-01T00:05:09+03:00');
});

test('log: структура запису (В6.2)', () => {
  const e = makeEntry({ level: 'WARN', stage: 'VALIDATE', check: 'П10', message: 'тест', details: { got: 'X' } }, new Date(T(9, 7, 15)));
  assert.equal(e.level, 'WARN');
  assert.equal(e.stage, 'VALIDATE');
  assert.equal(e.check, 'П10');
  assert.equal(e.message, 'тест');
  assert.deepEqual(e.details, { got: 'X' });
  assert.ok(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+\d{2}:\d{2}$/.test(e.time));
});

test('log: щоденник обрізається до 500 записів (В6.1)', () => {
  const log = Array.from({ length: 600 }, (_, i) => ({ time: String(i), level: 'INFO', stage: 'FETCH', check: '', message: 'x' }));
  const next = appendEntries(log, [makeEntry({ level: 'INFO', stage: 'FETCH', message: 'новий' })]);
  assert.equal(next.length, 500);
  assert.equal(next[next.length - 1].message, 'новий');
  assert.equal(next[0].time, '101'); // найстаріші видалено
});

test('log: перевірки перетворюються в записи з правильним рівнем і стадією', () => {
  const entries = checkToEntries([
    { code: 'П1', level: 'pass', message: 'a', expected: '200', got: '200', details: { url: 'u' } },
    { code: 'П5', level: 'warn', message: 'b', expected: '16', got: '116', details: {} },
    { code: 'П6', level: 'error', message: 'c', expected: 'x', got: 'y', details: {} },
  ]);
  assert.deepEqual(entries.map((e) => `${e.level}:${e.stage}:${e.check}`), ['INFO:FETCH:П1', 'WARN:RESOLVE_QUEUE:П5', 'ERROR:VALIDATE:П6']);
});
