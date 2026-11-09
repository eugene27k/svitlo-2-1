// Розрахунок моментів сповіщень, їх об'єднання та реакція на спрацювання (вимога В3).
import {
  kyivDateString, addDays, fmtHM, epochForMinute, minuteOfDay, mergeIntervals,
} from './schedule.js';
import { warnNotificationText, nowNotificationText, currentZoneNotification } from './texts.js';

/**
 * Моменти сповіщень для всіх майбутніх змін зони (В3.1–В3.6).
 * @returns {{moments: Array<{at: number, events: Array<{offset:number, zone:string, boundaryMin:number, boundaryEpoch:number, date:string}>}>}}
 */
export function planNotifications({ days, now }) {
  const todayStr = kyivDateString(now);
  const dates = Object.keys(days ?? {}).filter((d) => d >= todayStr).sort();
  const buckets = new Map(); // епоха моменту → події

  const addBoundary = (date, boundaryMin, zone) => {
    const boundaryEpoch = epochForMinute(date, boundaryMin);
    for (const offset of [30, 15, 0]) {
      const at = boundaryEpoch - offset * 60000;
      if (at <= now.getTime()) continue; // лише майбутні
      if (!buckets.has(at)) buckets.set(at, []);
      buckets.get(at).push({ offset, zone, boundaryMin, boundaryEpoch, date });
    }
  };

  for (const date of dates) {
    const ivs = mergeIntervals(days[date].slots);
    for (let i = 0; i + 1 < ivs.length; i++) addBoundary(date, ivs[i].endMin, ivs[i + 1].zone);
    // перехід опівночі (В3.5–В3.6): планується, лише якщо графік на завтра є і зони різні
    const nextDay = addDays(date, 1);
    if (days[nextDay]) {
      const tmIvs = mergeIntervals(days[nextDay].slots);
      if (tmIvs[0].zone !== ivs[ivs.length - 1].zone) addBoundary(date, 1440, tmIvs[0].zone);
    }
  }

  const cmp = (a, b) => (a.offset === 0 ? -1 : b.offset === 0 ? 1 : a.boundaryEpoch - b.boundaryEpoch || b.offset - a.offset);
  return {
    moments: [...buckets.entries()]
      .map(([at, events]) => ({ at, events: events.sort(cmp) }))
      .sort((x, y) => x.at - y.at),
  };
}

/**
 * Реакція на спрацювання сигналу (В3.15–В3.16, випадок 10).
 * Спрацювання пізніше ніж за хвилину після запланованого часу: попередження про зміни,
 * які вже відбулися, не надсилаються; якщо поточна зона відрізняється від останньої
 * оголошеної — одне сповіщення у форматі моменту зміни про поточну зону.
 */
export function handleNotifyFire({ moment, firedAt, days, notifiedZone }) {
  const firedMs = firedAt instanceof Date ? firedAt.getTime() : firedAt;
  const late = firedMs > moment.at + 60_000;
  const kept = late ? moment.events.filter((e) => e.boundaryEpoch > firedMs) : moment.events;
  const sends = [];
  let newNotifiedZone = null;

  if (late) {
    const cur = currentZoneNotification({ days, now: new Date(firedMs) });
    if (cur && cur.zone !== notifiedZone) {
      sends.push({ kind: 'reconcile', offset: 0, zone: cur.zone, title: cur.title, message: cur.message });
      newNotifiedZone = cur.zone;
    }
  }

  const nowEvent = kept.find((e) => e.offset === 0);
  if (nowEvent) {
    const t = nowNotificationText({ event: nowEvent, days });
    sends.push({ kind: 'now', offset: nowEvent.offset, zone: nowEvent.zone, ...t });
    newNotifiedZone = nowEvent.zone;
  } else if (kept.length) {
    const e = kept[0];
    const t = warnNotificationText({ event: e, days, now: new Date(firedMs) });
    sends.push({ kind: 'warn', offset: e.offset, zone: e.zone, ...t }); // offset: 30|15 — для вибору звуку (В3.18)
  }

  return { sends, newNotifiedZone };
}

/** Затримка повтору після невдалої спроби, хв (В1.4): 1-ша — 5, 2-га — 15, далі — 60 */
export function nextRetryDelayMin(consecutiveFailures) {
  if (consecutiveFailures <= 1) return 5;
  if (consecutiveFailures === 2) return 15;
  return 60;
}

// tests/fixtures-сумісне подання події: "T-30 yellow@07:00"
export function eventToString(e) {
  return `T-${e.offset} ${e.zone}@${fmtHM(e.boundaryMin)}`;
}

export function momentAtMinute(epoch) {
  return minuteOfDay(new Date(epoch));
}
