// Київський час, стани клітинок і відрізки черги (правила PRD 2.1–2.3).
// Чисті функції без chrome.*; поточний час завжди передається параметром.

export const KYIV_TZ = 'Europe/Kyiv';

// Еталон черги (розділ 2.4): обидві константи в одному місці.
export const QUEUE = Object.freeze({ name: '2.1', expectedId: 16 });

const dtf = new Intl.DateTimeFormat('en-US', {
  timeZone: KYIV_TZ,
  hourCycle: 'h23',
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
});

const pad2 = (n) => String(n).padStart(2, '0');

/** Частина дати за Києвом: {year, month, day, hour, minute, second} */
export function kyivParts(date) {
  const parts = {};
  for (const p of dtf.formatToParts(date)) if (p.type !== 'literal') parts[p.type] = p.value;
  return {
    year: +parts.year, month: +parts.month, day: +parts.day,
    hour: +parts.hour, minute: +parts.minute, second: +parts.second,
  };
}

/** Зміщення Києва (мс) у момент ts: київський час як UTC мінус сам момент */
function kyivOffsetMs(ts) {
  const p = kyivParts(new Date(ts));
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - ts;
}

/** Епоха (мс) за київським часом {year, month, day, hour, minute, second} */
export function kyivToEpoch({ year, month, day, hour = 0, minute = 0, second = 0 }) {
  const asUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  let ts = asUtc - 2 * 3600 * 1000; // початкове наближення
  for (let i = 0; i < 3; i++) ts = asUtc - kyivOffsetMs(ts);
  return ts;
}

/** Дата за Києвом у форматі YYYY-MM-DD */
export function kyivDateString(date) {
  const p = kyivParts(date);
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;
}

/** Хвилина доби за Києвом (дробова) */
export function minuteOfDay(date) {
  const p = kyivParts(date);
  return p.hour * 60 + p.minute + p.second / 60 + (date.getMilliseconds() || 0) / 60000;
}

/** YYYY-MM-DD + n днів */
export function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d) + n * 86400000);
  return `${t.getUTCFullYear()}-${pad2(t.getUTCMonth() + 1)}-${pad2(t.getUTCDate())}`;
}

/** «ГГ:ХХ»; 1440 → «24:00» (кінець доби, В3.12) */
export function fmtHM(minute) {
  const m = Math.floor(minute);
  if (m >= 1440) return '24:00';
  return `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`;
}

/** «ДД.ММ» із YYYY-MM-DD */
export function fmtDM(dateStr) {
  const [, m, d] = dateStr.split('-');
  return `${d}.${m}`;
}

/** Епоха початку хвилини minute у дату dateStr за Києвом */
export function epochForMinute(dateStr, minute) {
  if (minute >= 1440) return kyivToEpoch({ ...parseDateStr(addDays(dateStr, 1)), hour: 0, minute: 0 });
  const p = parseDateStr(dateStr);
  return kyivToEpoch({ ...p, hour: Math.floor(minute / 60), minute: minute % 60 });
}

function parseDateStr(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return { year: y, month: m, day: d };
}

/** Відповідність типу запису зоні (розділ 2.3): OFF/SURE_OFF — червона, інші невідомі — жовта */
export function zoneOfType(type) {
  if (type === 'OFF' || type === 'SURE_OFF') return 'red';
  if (type === 'ENABLE') return 'green';
  return 'yellow'; // PROBABLY_OFF і будь-яке невідоме значення (П10)
}

/** Дата графіка — дата from за київським часом (правило 2.1); null, якщо from не розбирається */
export function dateOfSchedule(item) {
  const t = Date.parse(item?.from ?? '');
  if (!Number.isFinite(t)) return null;
  return kyivDateString(new Date(t));
}

/**
 * Стани 48 клітинок черги за правилом 2.2: записи в порядку масиву,
 * кожен наступний замінює попередній, крім випадку вже записаного SURE_OFF.
 */
export function buildDaySlots({ schedulesForDate, queueId, tsIdToSlot }) {
  const slots = new Array(48).fill('ENABLE');
  const unknownTypes = [];
  for (const schedule of schedulesForDate) {
    for (const rec of schedule.series ?? []) {
      if (rec.outage_queue_id !== queueId) continue;
      const slot = tsIdToSlot.get(rec.time_series_id);
      if (slot === undefined) continue; // відкинуто перевіркою П8
      if (slots[slot] === 'SURE_OFF') continue; // SURE_OFF більше не змінюється
      slots[slot] = rec.type;
      if (!unknownTypes.includes(rec.type) && rec.type !== 'OFF' && rec.type !== 'SURE_OFF' && rec.type !== 'PROBABLY_OFF') {
        unknownTypes.push(rec.type);
      }
    }
  }
  return { slots, unknownTypes };
}

/** Злиття сусідніх проміжків з однаковою зоною в відрізки (правило 2.3) */
export function mergeIntervals(slots) {
  const out = [];
  for (let i = 0; i < slots.length; i++) {
    const zone = zoneOfType(slots[i]);
    const last = out[out.length - 1];
    if (last && last.zone === zone) {
      last.endMin += 30;
      if (!last.types.includes(slots[i])) last.types.push(slots[i]);
      if (slots[i] === 'SURE_OFF') last.hasSureOff = true;
    } else {
      out.push({ startMin: i * 30, endMin: (i + 1) * 30, zone, types: [slots[i]], hasSureOff: slots[i] === 'SURE_OFF' });
    }
  }
  return out;
}

/** Поточний відрізок за часом now: {date, iv, ivs} або null, якщо графіка на дату немає */
export function currentIntervalAt(days, now) {
  const date = kyivDateString(now);
  const day = days?.[date];
  if (!day) return null;
  const min = minuteOfDay(now);
  const ivs = mergeIntervals(day.slots);
  const iv = ivs.find((x) => x.startMin <= min && min < x.endMin);
  if (!iv) return null;
  return { date, iv, ivs };
}
