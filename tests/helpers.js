// Спільні помічники для тестів: завантаження контрольних даних із fixtures/
import { readFileSync } from 'node:fs';
import { kyivToEpoch, fmtHM, minuteOfDay } from '../src/schedule.js';

export function loadFixture(name) {
  return JSON.parse(readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8'));
}

export function loadControl() {
  return {
    timeSeries: loadFixture('time-series.json'),
    queues: loadFixture('outage-queue-by-type-3.json'),
    schedules: loadFixture('schedule-active-2026-11-09.json'),
    expected: loadFixture('expected-queue-2.1-2026-11-09.json'),
  };
}

// Епоха за київським часом на контрольну дату
export const T = (day, h, m = 0, s = 0) => kyivToEpoch({ year: 2026, month: 11, day, hour: h, minute: m, second: s });

// «ГГ:ХХ» за Києвом для епохи
export function hm(epoch) {
  return fmtHM(Math.round(minuteOfDay(new Date(epoch))));
}

// Рядок події у форматі fixtures: "T-30 yellow@07:00"
export function eventToString(e) {
  return `T-${e.offset} ${e.zone}@${fmtHM(e.boundaryMin)}`;
}

// Побудова відповідей для validateData з готових об'єктів
export function responsesFrom({ timeSeries, queues, schedules }) {
  return {
    timeSeries: { url: 'u1', status: 200, bodyText: JSON.stringify(timeSeries), durationMs: 10, error: null },
    queues: { url: 'u2', status: 200, bodyText: JSON.stringify(queues), durationMs: 10, error: null },
    schedules: { url: 'u3', status: 200, bodyText: JSON.stringify(schedules), durationMs: 10, error: null },
  };
}

export function controlResponses() {
  const c = loadControl();
  return responsesFrom(c);
}
