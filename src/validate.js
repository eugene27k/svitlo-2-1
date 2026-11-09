// Перевірки даних П1–П12 (вимога В2). Чиста функція: відповіді → результат перевірок + дані.
import { kyivParts, kyivDateString, addDays, buildDaySlots } from './schedule.js';

const HMS_RE = /^([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/;
const KNOWN_TYPES = new Set(['OFF', 'PROBABLY_OFF', 'SURE_OFF']);
const SLOTS_PER_DAY = 48;

function hmsToMin(s) {
  const [h, m, sec] = s.split(':').map(Number);
  return h * 60 + m + sec / 60;
}

/**
 * @param {object} args
 * @param {object} args.responses   { timeSeries, queues, schedules } — результати api.js:
 *   { url, status, bodyText, durationMs, error }
 * @param {Date}   args.now
 * @param {string} args.queueName     еталонна назва черги («2.1»)
 * @param {number} args.expectedQueueId еталонний внутрішній номер (16)
 * @returns {{ok: boolean, checks: Array, data: null|object}}
 */
export function validateData({ responses, now, queueName, expectedQueueId }) {
  const checks = [];
  const add = (code, level, message, expected, got, details = {}) => checks.push({ code, level, message, expected: String(expected), got: String(got), details });

  // П1: код відповіді 200
  let hadError = false;
  for (const key of ['timeSeries', 'queues', 'schedules']) {
    const r = responses[key];
    if (r.error) {
      add('П1', 'error', `${key}: запит не вдався — ${r.error}`, 'HTTP 200', 'мережева помилка', { url: r.url, status: r.status, durationMs: r.durationMs, error: r.error });
      hadError = true;
    } else if (r.status !== 200) {
      add('П1', 'error', `${key}: код відповіді ${r.status}`, '200', r.status, { url: r.url, status: r.status, durationMs: r.durationMs });
      hadError = true;
    } else {
      add('П1', 'pass', `${key}: код відповіді 200`, '200', 200, { url: r.url, status: r.status, durationMs: r.durationMs });
    }
  }
  if (hadError) return { ok: false, checks, data: null };

  // П2: тіло розбирається як JSON; перші 2000 символів — для звіту
  const parsed = {};
  let parseError = false;
  for (const key of ['timeSeries', 'queues', 'schedules']) {
    const r = responses[key];
    try {
      parsed[key] = JSON.parse(r.bodyText);
      add('П2', 'pass', `${key}: JSON розібрано`, 'JSON', 'JSON', { url: r.url, durationMs: r.durationMs });
    } catch {
      parsed[key] = null;
      parseError = true;
      add('П2', 'error', `${key}: тіло відповіді не розбирається як JSON`, 'JSON', 'не JSON', {
        url: r.url, status: r.status, durationMs: r.durationMs, bodyExcerpt: String(r.bodyText ?? '').slice(0, 2000),
      });
    }
  }
  if (parseError) return { ok: false, checks, data: null };

  // П3: 48 півгодинних проміжків підряд від 00:00:00 до 00:00:00
  const ts = parsed.timeSeries;
  const tsProblems = [];
  if (!Array.isArray(ts)) tsProblems.push('не масив');
  else {
    if (ts.length !== SLOTS_PER_DAY) tsProblems.push(`записів ${ts.length} замість 48`);
    for (let i = 0; i < ts.length; i++) {
      const r = ts[i];
      if (!r || typeof r !== 'object') { tsProblems.push(`запис ${i}: не об’єкт`); continue; }
      if (!Number.isInteger(r.id)) tsProblems.push(`запис ${i}: id не ціле (${JSON.stringify(r.id)})`);
      if (!HMS_RE.test(String(r.start ?? '')) || !HMS_RE.test(String(r.end ?? ''))) {
        tsProblems.push(`запис ${i}: start/end не у форматі ГГ:ХХ:СС (${r.start}–${r.end})`);
        continue;
      }
      if (hmsToMin(r.start) !== i * 30) tsProblems.push(`запис ${i}: start ${r.start} замість ${i * 30} хв доби`);
      const expectedEnd = ((i + 1) * 30) % 1440;
      if (hmsToMin(r.end) !== expectedEnd) tsProblems.push(`запис ${i}: end ${r.end} замість ${expectedEnd} хв доби`);
    }
  }
  if (tsProblems.length) {
    add('П3', 'error', `time-series: ${tsProblems.slice(0, 5).join('; ')}${tsProblems.length > 5 ? ` …(усього ${tsProblems.length})` : ''}`, '48 проміжків по 30 хв підряд', tsProblems.length, { problems: tsProblems.slice(0, 20) });
    return { ok: false, checks, data: null };
  }
  add('П3', 'pass', 'time-series: 48 проміжків підряд по 30 хвилин', '48', 48);

  // П4: рівно один запис з назвою черги
  const queues = parsed.queues;
  if (!Array.isArray(queues)) {
    add('П4', 'error', 'by-type/3: відповідь не масив', 'масив черг', typeof queues);
    return { ok: false, checks, data: null };
  }
  const matches = queues.filter((q) => q && q.name === queueName);
  if (matches.length !== 1) {
    add('П4', 'error', `by-type/3: записів з назвою «${queueName}» — ${matches.length}`, 'рівно 1', matches.length, { found: matches.map((q) => ({ id: q.id, name: q.name })) });
    return { ok: false, checks, data: null };
  }
  add('П4', 'pass', `by-type/3: рівно один запис з назвою «${queueName}»`, '1', 1);

  // П5: внутрішній номер черги дорівнює еталону
  const queueRecord = matches[0];
  const queueId = queueRecord.id;
  if (!Number.isInteger(queueId)) {
    add('П5', 'error', `by-type/3: номер черги «${queueName}» не ціле число (${JSON.stringify(queueId)})`, 'ціле число', JSON.stringify(queueId));
    return { ok: false, checks, data: null };
  }
  if (queueId !== expectedQueueId) {
    add('П5', 'warn', `Внутрішній номер черги «${queueName}» — ${queueId}, а не ${expectedQueueId}; використано номер за назвою`, expectedQueueId, queueId);
  } else {
    add('П5', 'pass', `Внутрішній номер черги «${queueName}» — ${queueId}`, expectedQueueId, queueId);
  }

  // П6: структура графіків
  const schedules = parsed.schedules;
  if (!Array.isArray(schedules)) {
    add('П6', 'error', 'schedule/active: відповідь не масив', 'масив графіків', typeof schedules);
    return { ok: false, checks, data: null };
  }
  const bad6 = [];
  schedules.forEach((s, si) => {
    const fromOk = Number.isFinite(Date.parse(s?.from ?? ''));
    const toOk = Number.isFinite(Date.parse(s?.to ?? ''));
    const seriesOk = Array.isArray(s?.series);
    if (!fromOk || !toOk || !seriesOk) {
      bad6.push(`графік ${si}: ${!fromOk ? 'from не розбирається ' : ''}${!toOk ? 'to не розбирається ' : ''}${!seriesOk ? 'series не масив' : ''}`.trim());
      return;
    }
    s.series.forEach((e, ei) => {
      if (!e || typeof e !== 'object') { bad6.push(`графік ${si}, запис ${ei}: не об’єкт`); return; }
      if (!Number.isInteger(e.outage_queue_id) || !Number.isInteger(e.time_series_id) || typeof e.type !== 'string') {
        bad6.push(`графік ${si}, запис ${ei}: outage_queue_id/time_series_id/type (${e.outage_queue_id}, ${e.time_series_id}, ${JSON.stringify(e.type)})`);
      }
    });
  });
  if (bad6.length) {
    add('П6', 'error', `schedule/active: ${bad6.slice(0, 5).join('; ')}${bad6.length > 5 ? ` …(усього ${bad6.length})` : ''}`, 'цілі id і рядок type', bad6.length, { problems: bad6.slice(0, 20) });
    return { ok: false, checks, data: null };
  }
  add('П6', 'pass', `schedule/active: ${schedules.length} графіків, структура записів коректна`, 'коректна структура', 'коректна структура');

  // П7: from о 00:00, to о 23:59 тієї самої дати за Києвом
  const p7bad = [];
  for (const s of schedules) {
    const fp = kyivParts(new Date(Date.parse(s.from)));
    const tp = kyivParts(new Date(Date.parse(s.to)));
    const fromMidnight = fp.hour === 0 && fp.minute === 0 && fp.second === 0;
    const toEnd = tp.hour === 23 && tp.minute === 59;
    if (!fromMidnight || !toEnd || fp.year !== tp.year || fp.month !== tp.month || fp.day !== tp.day) {
      p7bad.push(`${s.from}…${s.to} (Київ: ${fp.hour}:${String(fp.minute).padStart(2, '0')}–${tp.hour}:${String(tp.minute).padStart(2, '0')})`);
    }
  }
  if (p7bad.length) add('П7', 'warn', `Графики не з 00:00 до 23:59 за Києвом: ${p7bad.join('; ')}; дату визначено за правилом 2.1`, '00:00–23:59', p7bad.length);
  else add('П7', 'pass', 'Усі графіки з 00:00 до 23:59 за Києвом', '00:00–23:59', '00:00–23:59');

  // Групування за датою (правило 2.1), об'єднання графіків однієї дати
  const byDate = new Map();
  for (const s of schedules) {
    const d = kyivDateString(new Date(Date.parse(s.from)));
    if (!byDate.has(d)) byDate.set(d, []);
    byDate.get(d).push(s);
  }

  // П8: невідомі time_series_id — записи відкидаються з попередженням
  const tsIdToSlot = new Map(ts.map((r, i) => [r.id, i]));
  let dropped8 = 0;
  for (const s of schedules) {
    s.series = s.series.filter((e) => {
      if (tsIdToSlot.has(e.time_series_id)) return true;
      dropped8++;
      add('П8', 'warn', `Запис відкинуто: невідомий time_series_id ${e.time_series_id}`, 'id з time-series', e.time_series_id, { outage_queue_id: e.outage_queue_id, time_series_id: e.time_series_id, type: e.type });
      return false;
    });
  }
  if (dropped8 === 0) add('П8', 'pass', 'Усі time_series_id відомі', '48 відомих id', '48 відомих id');

  // П9: невідомі outage_queue_id — записи відкидаються з попередженням
  const knownQueueIds = new Set(queues.map((q) => q.id));
  let dropped9 = 0;
  for (const s of schedules) {
    s.series = s.series.filter((e) => {
      if (knownQueueIds.has(e.outage_queue_id)) return true;
      dropped9++;
      add('П9', 'warn', `Запис відкинуто: невідома черга ${e.outage_queue_id}`, 'id з by-type/3', e.outage_queue_id, { outage_queue_id: e.outage_queue_id, time_series_id: e.time_series_id, type: e.type });
      return false;
    });
  }
  if (dropped9 === 0) add('П9', 'pass', 'Усі outage_queue_id відомі', 'відома черга', 'відома черга');

  // П10: невідомі type — жовта зона, попередження зі значенням
  const unknownTypes = [];
  for (const s of schedules) {
    for (const e of s.series) {
      if (!KNOWN_TYPES.has(e.type) && !unknownTypes.includes(e.type)) {
        unknownTypes.push(e.type);
        add('П10', 'warn', `Невідомий стан «${e.type}» — показано як жовту зону`, 'OFF | PROBABLY_OFF | SURE_OFF', e.type);
      }
    }
  }
  if (unknownTypes.length === 0) add('П10', 'pass', 'Усі type відомі', 'OFF/PROBABLY_OFF/SURE_OFF', 'OFF/PROBABLY_OFF/SURE_OFF');

  // Побудова днів для черги
  const days = {};
  for (const [date, list] of byDate) {
    days[date] = buildDaySlots({ schedulesForDate: list, queueId, tsIdToSlot });
  }

  // П11: є графік на сьогодні
  const today = kyivDateString(now);
  if (days[today]) add('П11', 'pass', `Є графік на сьогодні (${today})`, 'є', 'є');
  else add('П11', 'warn', `Немає графіка на сьогодні (${today}); поточна зона — «немає даних»`, 'є графік', 'немає');

  // П12: для інформації — записи черги на кожну дату і графік на завтра
  for (const [date, day] of Object.entries(days)) {
    const n = day.slots.filter((t) => t !== 'ENABLE').length;
    add('П12', 'info', `Черга ${queueName} на ${date}: ${n} записів`, 'інформація', n);
  }
  const tomorrow = addDays(today, 1);
  add('П12', 'info', days[tomorrow] ? `Графік на завтра (${tomorrow}) є` : `Графіка на завтра (${tomorrow}) немає`, 'інформація', days[tomorrow] ? 'є' : 'немає');

  return {
    ok: true,
    checks,
    data: {
      queueId,
      queueRecord,
      days,
      unknownTypes,
      timeSeries: ts,
    },
  };
}
