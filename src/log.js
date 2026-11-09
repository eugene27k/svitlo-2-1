// Журнал (вимога В6): записи з київським зміщенням, щоденник до 500 записів.
import { kyivParts } from './schedule.js';

const MAX_ENTRIES = 500;
const pad2 = (n) => String(n).padStart(2, '0');

/** ISO-мітка часу з київським зміщенням: 2026-11-09T07:15:00+02:00 */
export function isoKyiv(date) {
  const ts = date instanceof Date ? date.getTime() : date;
  const p = kyivParts(new Date(ts));
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  const offsetMin = Math.round((asUtc - ts) / 60000);
  const sign = offsetMin >= 0 ? '+' : '-';
  const off = Math.abs(offsetMin);
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}T${pad2(p.hour)}:${pad2(p.minute)}:${pad2(p.second)}${sign}${pad2(Math.floor(off / 60))}:${pad2(off % 60)}`;
}

/** Новий запис журналу (В6.2) */
export function makeEntry({ level, stage, check = '', message, details = undefined }, now = new Date()) {
  return { time: isoKyiv(now), level, stage, check, message, details };
}

/** Додавання записів із обрізанням до 500 найновіших (В6.1) */
export function appendEntries(log, entries) {
  const next = [...(log ?? []), ...entries];
  return next.length > MAX_ENTRIES ? next.slice(next.length - MAX_ENTRIES) : next;
}

/** Перевірка П1–П12 → стадія журналу (В6.2) */
const CHECK_STAGE = {
  П1: 'FETCH', П2: 'PARSE', П3: 'VALIDATE', П4: 'RESOLVE_QUEUE', П5: 'RESOLVE_QUEUE',
  П6: 'VALIDATE', П7: 'VALIDATE', П8: 'VALIDATE', П9: 'VALIDATE', П10: 'VALIDATE',
  П11: 'VALIDATE', П12: 'VALIDATE',
};
const CHECK_LEVEL = { pass: 'INFO', warn: 'WARN', error: 'ERROR', info: 'INFO' };

/** Результати перевірок → записи журналу */
export function checkToEntries(checks, now = new Date()) {
  return (checks ?? []).map((c) => makeEntry({
    level: CHECK_LEVEL[c.level] ?? 'INFO',
    stage: CHECK_STAGE[c.code] ?? 'VALIDATE',
    check: c.code,
    message: c.message,
    details: { expected: c.expected, got: c.got, ...c.details },
  }, now));
}
