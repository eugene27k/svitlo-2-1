// Тексти сповіщень, мітка значка, модель вікна і звіт для налагодження (В3.7–В3.13, В4, В6).
// Чисті функції: увесь час — київський, поточний час передається параметром.
import {
  QUEUE, kyivDateString, kyivParts, addDays, fmtHM, fmtDM, minuteOfDay, epochForMinute,
  mergeIntervals, currentIntervalAt, zoneOfType,
} from './schedule.js';

const pad2 = (n) => String(n).padStart(2, '0');

/* ---------- Зони ---------- */

export function zoneWord(zone) {
  return { red: 'червона зона', yellow: 'жовта зона', green: 'зелена зона', none: 'немає даних' }[zone] ?? zone;
}

export function zoneShort(zone) {
  return { red: 'червона', yellow: 'жовта', green: 'зелена', none: 'немає даних' }[zone] ?? zone;
}

/** В3.11: опис зони; червона з SURE_OFF — «актуальне відключення» */
export function zoneDescription(iv) {
  if (iv.zone === 'red') return iv.hasSureOff ? 'актуальне відключення' : 'заплановане відключення';
  if (iv.zone === 'yellow') return 'електропостачання можливе';
  if (iv.zone === 'green') return 'є світло';
  return 'стан невідомий';
}

/** В4.1 / В3.13: кольори зон */
export function zoneColor(zone) {
  return { red: '#D93025', yellow: '#F9AB00', green: '#1E8E3E', none: '#80868B' }[zone] ?? '#80868B';
}

/* ---------- Відрізки ---------- */

function intervalsOf(days, date) {
  const day = days?.[date];
  return day ? mergeIntervals(day.slots) : [];
}

function segmentAt(days, date, minute) {
  return intervalsOf(days, date).find((iv) => iv.startMin === minute) ?? null;
}

/**
 * В3.12: кінець відрізка. Відрізок до кінця доби закінчується «24:00», якщо графіка
 * на завтра немає, або справжнім кінцем за графіком на завтра (поки зона та сама).
 * @returns {{endText: string, nextIv: object|null}}
 */
export function extendedSegment({ date, iv, days }) {
  if (iv.endMin < 1440) {
    const ivs = intervalsOf(days, date);
    return { endText: fmtHM(iv.endMin), nextIv: ivs.find((x) => x.startMin >= iv.endMin) ?? null };
  }
  const nextDay = addDays(date, 1);
  const tmIvs = intervalsOf(days, nextDay);
  if (tmIvs.length === 0) return { endText: '24:00', nextIv: null };
  let i = 0;
  while (i < tmIvs.length && tmIvs[i].zone === iv.zone) i++;
  if (i === 0) return { endText: '24:00', nextIv: tmIvs[0] };
  if (i < tmIvs.length) return { endText: fmtHM(tmIvs[i].startMin), nextIv: tmIvs[i] };
  return { endText: '24:00', nextIv: null }; // завтра тієї самої зони до кінця
}

/* ---------- Сповіщення про зміну зони (В3.7–В3.10) ---------- */

/** Попередження за 30/15 хв (В3.7–В3.8) */
export function warnNotificationText({ event, days, now }) {
  const n = Math.max(1, Math.ceil((event.boundaryEpoch - (now instanceof Date ? now.getTime() : now)) / 60000));
  const seg = segmentAt(days, event.date, event.boundaryMin);
  const ext = extendedSegment({ date: event.date, iv: seg, days });
  const cur = currentIntervalAt(days, now);
  const curPart = cur ? ` Зараз: ${zoneWord(cur.iv.zone)}, ${zoneDescription(cur.iv)}.` : '';
  return {
    title: `Черга 2.1 · через ${n} хв: ${zoneWord(event.zone)}`,
    message: `З ${fmtHM(event.boundaryMin)} до ${ext.endText} — ${zoneDescription(seg)}.${curPart}`,
  };
}

/** Сповіщення в момент зміни (В3.9–В3.10) */
export function nowNotificationText({ event, days }) {
  const seg = segmentAt(days, event.date, event.boundaryMin);
  const ext = extendedSegment({ date: event.date, iv: seg, days });
  const nextPart = ext.nextIv
    ? `Далі: ${zoneWord(ext.nextIv.zone)}, ${zoneDescription(ext.nextIv)}.`
    : 'Далі: графік на завтра ще не опубліковано.';
  return {
    title: `Черга 2.1 · зараз: ${zoneWord(event.zone)}`,
    message: `До ${ext.endText} — ${zoneDescription(seg)}. ${nextPart}`,
  };
}

/** В3.16: сповіщення про поточну зону у форматі моменту зміни; null, якщо даних немає */
export function currentZoneNotification({ days, now }) {
  const cur = currentIntervalAt(days, now);
  if (!cur) return null;
  const t = nowNotificationText({ event: { date: cur.date, boundaryMin: cur.iv.startMin, zone: cur.iv.zone }, days });
  return { zone: cur.iv.zone, ...t };
}

/* ---------- Значок (В4.1–В4.5, В4.11) ---------- */

export function badgeState({ days, now, lastSuccessAt }) {
  const todayStr = kyivDateString(now);
  const day = days?.[todayStr];
  if (!day) return { color: zoneColor('none'), text: '?', blink: null };
  const cur = currentIntervalAt(days, now);
  const minNow = minuteOfDay(now);

  // наступна зміна зони: спочатку сьогодні, потім опівніччя і завтра
  let nextChange = null;
  let nextZone = null;
  const ivs = mergeIntervals(day.slots);
  for (const iv of ivs) {
    if (iv.startMin > minNow) { nextChange = epochForMinute(todayStr, iv.startMin); nextZone = iv.zone; break; }
  }
  if (nextChange === null) {
    const nextDay = addDays(todayStr, 1);
    const tmIvs = intervalsOf(days, nextDay);
    if (tmIvs.length > 0) {
      const last = ivs[ivs.length - 1];
      if (tmIvs[0].zone !== last.zone) {
        nextChange = epochForMinute(nextDay, 0);
        nextZone = tmIvs[0].zone;
      } else {
        const firstDiff = tmIvs.find((iv) => iv.zone !== last.zone);
        if (firstDiff) { nextChange = epochForMinute(nextDay, firstDiff.startMin); nextZone = firstDiff.zone; }
      }
    }
  }

  let text = '';
  if (nextChange !== null) {
    const mins = Math.ceil((nextChange - now.getTime()) / 60000);
    text = mins < 60 ? `${mins}хв` : `${Math.floor(mins / 60)}г`;
  }
  const stale = lastSuccessAt != null && now.getTime() - lastSuccessAt > 3 * 3600 * 1000;
  if (stale) text = '!';
  // В4.11: вікно моргання — останні 15 хв до зміни; застарілі дані вимикають його
  const blink = !stale && nextChange !== null && nextChange - now.getTime() <= 15 * 60_000
    ? { color: zoneColor(nextZone), until: nextChange }
    : null;
  return { color: zoneColor(cur ? cur.iv.zone : 'none'), text, blink };
}

/* ---------- Вікно розширення (В4.7) ---------- */

const fmtClock = (epoch) => {
  const p = kyivParts(new Date(epoch));
  return `${pad2(p.hour)}:${pad2(p.minute)}`;
};
export const fmtDMHM = (epoch) => {
  const p = kyivParts(new Date(epoch));
  return `${pad2(p.day)}.${pad2(p.month)}.${p.year} ${pad2(p.hour)}:${pad2(p.minute)}`;
};
const fmtDMoHM = (epoch) => {
  const p = kyivParts(new Date(epoch));
  return `${pad2(p.day)}.${pad2(p.month)} о ${pad2(p.hour)}:${pad2(p.minute)}`;
};

function segmentLine(iv) {
  return `${fmtHM(iv.startMin)}–${fmtHM(iv.endMin)} · ${zoneShort(iv.zone)} · ${zoneDescription(iv)}`;
}

/** Рядки вікна розширення (В4.7). Чиста функція — popup лише рендерить. */
export function popupModel({ state, now }) {
  const days = state?.days ?? {};
  const todayStr = kyivDateString(now);
  const cur = currentIntervalAt(days, now);

  let currentLine = 'Зараз: немає даних';
  let nextLine = null;
  if (cur) {
    const ext = extendedSegment({ date: cur.date, iv: cur.iv, days });
    currentLine = `Зараз: ${zoneWord(cur.iv.zone)} — ${zoneDescription(cur.iv)}, до ${ext.endText}`;
    nextLine = ext.nextIv
      ? `Далі: ${zoneWord(ext.nextIv.zone)} з ${fmtHM(ext.nextIv.startMin)} до ${extendedSegment({ date: cur.date, iv: ext.nextIv, days }).endText}`
      : 'Далі: графік на завтра ще не опубліковано';
  }

  const todayIvs = intervalsOf(days, todayStr);
  const tomorrowStr = addDays(todayStr, 1);
  const tomorrowIvs = intervalsOf(days, tomorrowStr);

  const checks = state?.checks ?? [];
  const warns = checks.filter((c) => c.level === 'warn').length;
  const errors = checks.filter((c) => c.level === 'error').length;
  const resultWord = { pass: 'ок', warn: 'попередження', error: 'помилка', info: 'інформація' };
  const unknownTypeNotes = (days[todayStr]?.unknownTypes ?? []).map(
    (t) => `У графіку невідомий стан «${t}» — показано як жовту зону`,
  );

  return {
    title: `Черга ${QUEUE.name}`,
    currentLine,
    nextLine,
    todayTitle: `Сьогодні, ${fmtDM(todayStr)}`,
    todayList: todayIvs.map(segmentLine),
    tomorrowTitle: `Завтра, ${fmtDM(tomorrowStr)}`,
    tomorrowList: tomorrowIvs.map(segmentLine),
    tomorrowNote: tomorrowIvs.length ? null : 'Графік на завтра ще не опубліковано',
    updatedLine: state?.lastSuccessAt != null
      ? `Оновлено о ${fmtClock(state.lastSuccessAt)} · наступне оновлення о ${state.nextUpdateAt != null ? fmtClock(state.nextUpdateAt) : '—'}`
      : 'Ще не оновлено',
    verifyLine: state?.queue?.foundId != null
      ? `Черга 2.1 = внутрішній номер ${state.queue.foundId} (звірено о ${fmtClock(state.queue.verifiedAt)})`
      : `Черга 2.1 = внутрішній номер ще не знайдено (очікується ${QUEUE.expectedId})`,
    checksLine: warns + errors === 0 ? 'Перевірки: усе гаразд' : `Перевірки: ${warns} попереджень, ${errors} помилок`,
    checksList: checks.map((c) => `${c.code} ${resultWord[c.level]}: ${c.message}`),
    unknownTypeNotes,
  };
}

/* ---------- Смуги доби у вікні (додатково до В4.7) ---------- */

/** Тривалість у хвилинах словами: 30 → «30 хв», 90 → «1 год 30 хв», 240 → «4 год» */
export function fmtDuration(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m} хв`;
  return m === 0 ? `${h} год` : `${h} год ${m} хв`;
}

/**
 * Модель візуального розкладу: кольорові смуги на 24 години для сьогодні й завтра.
 * Чиста функція — popup лише рендерить: смуги з відсотками ширини, підказки
 * з тривалістю та підсумки тривалостей зон за добу. Смуги показуються завжди,
 * під заголовками «Сьогодні»/«Завтра» вікна, тому власних назв дні не мають.
 */
export function timelineModel({ state, now }) {
  const days = state?.days ?? {};
  const todayStr = kyivDateString(now);
  const dayModel = (dateStr) => {
    const ivs = intervalsOf(days, dateStr);
    const byZone = { red: 0, yellow: 0, green: 0 };
    for (const iv of ivs) byZone[iv.zone] += iv.endMin - iv.startMin;
    return {
      empty: ivs.length === 0,
      bars: ivs.map((iv) => ({
        zone: iv.zone,
        startMin: iv.startMin,
        endMin: iv.endMin,
        pct: ((iv.endMin - iv.startMin) / 1440) * 100,
        tooltip: `${fmtHM(iv.startMin)}–${fmtHM(iv.endMin)} · ${zoneShort(iv.zone)} · ${zoneDescription(iv)} · ${fmtDuration(iv.endMin - iv.startMin)}`,
      })),
      legend: ['red', 'yellow', 'green']
        .filter((z) => byZone[z] > 0)
        .map((z) => ({ zone: z, minutes: byZone[z], text: fmtDuration(byZone[z]) })),
    };
  };
  return {
    nowPct: (minuteOfDay(now) / 1440) * 100,
    today: dayModel(todayStr),
    tomorrow: dayModel(addDays(todayStr, 1)),
  };
}

/* ---------- Спеціальні сповіщення (В2.5, В2.15, В4.9) ---------- */

export function queueIdChangedNotification(foundId) {
  const text = `Черга 2.1: внутрішній номер на сайті змінився з ${QUEUE.expectedId} на ${foundId}`;
  return { title: text, message: text };
}

export function fetchFailureNotification(lastSuccessAt) {
  const when = lastSuccessAt != null ? `${fmtDMoHM(lastSuccessAt)}` : '—';
  return {
    title: 'Черга 2.1: не вдалося оновити графік',
    message: `Останнє успішне оновлення: ${when}. Відкрийте розширення, щоб скопіювати звіт.`,
  };
}

export const TEST_NOTIFICATION = {
  title: 'Черга 2.1 · тест',
  message: 'Якщо ви це бачите, сповіщення працюють.',
};

/* Підказки (title + aria-label) іконок у шапці вікна; тема має свою — THEME_META (В4.7) */
export const TOOLBAR_TITLES = {
  refresh: 'Оновити зараз',
  copyReport: 'Скопіювати звіт для налагодження',
  testNotification: 'Надіслати тестове сповіщення',
  sounds: 'Прослухати звуки зон',
  openSite: 'Відкрити сайт обленерго',
};

/* ---------- Звіт для налагодження (В6.6) ---------- */

function logLine(e) {
  const details = e.details && Object.keys(e.details).length ? ` · ${JSON.stringify(e.details)}` : '';
  return `- \`${e.time}\` ${e.level} ${e.stage}${e.check ? ` ${e.check}` : ''} ${e.message}${details}`;
}

function reportChecksTable(checks) {
  if (!checks?.length) return '_Перевірки ще не виконувалися._';
  const word = { pass: 'ок', warn: 'попередження', error: 'помилка', info: 'інформація' };
  const rows = checks.map((c) => `| ${c.code} | ${word[c.level] ?? c.level} | ${c.expected} | ${c.got} |`);
  return ['| Код | Результат | Очікуване | Отримане |', '|---|---|---|---|', ...rows].join('\n');
}

/**
 * Звіт у форматі Markdown (В6.6), розділи в порядку PRD.
 * Особисті дані — лише рядок navigator.userAgent (В6.7).
 */
export function buildReport({ extensionVersion, userAgent, systemTimeZone, now, state, log, alarms, raw }) {
  const days = state?.days ?? {};
  const nowKyiv = fmtDMHM(now instanceof Date ? now.getTime() : now);
  const out = [];

  out.push('Звіт розширення «Світло 2.1» для налагодження. Очікувана поведінка описана в PRD.md.', '');
  out.push('## Загальне', '');
  out.push(`- Версія розширення: ${extensionVersion}`);
  out.push(`- navigator.userAgent: \`${userAgent}\``);
  out.push(`- Часовий пояс системи: ${systemTimeZone}`);
  out.push(`- Час формування звіту (Київ): ${nowKyiv}`, '');

  out.push('## Черга 2.1', '');
  out.push(`- Еталон черги: назва «${QUEUE.name}», очікуваний внутрішній номер ${QUEUE.expectedId}`);
  out.push(`- Знайдений внутрішній номер: ${state?.queue?.foundId ?? '—'}${state?.queue?.verifiedAt != null ? ` (звірено о ${fmtClock(state.queue.verifiedAt)})` : ''}`, '');

  out.push('## Оновлення', '');
  out.push(`- Остання спроба: ${state?.lastAttemptAt != null ? `${fmtDMHM(state.lastAttemptAt)} — ${state.lastAttemptOk ? 'успіх' : 'помилка'}` : '—'}`);
  out.push(`- Невдалих спроб поспіль: ${state?.consecutiveFailures ?? 0}`);
  out.push(`- Останнє успішне оновлення: ${state?.lastSuccessAt != null ? fmtDMHM(state.lastSuccessAt) : '—'}`, '');

  out.push('## Перевірки П1–П12 останньої спроби', '');
  out.push(reportChecksTable(state?.checks), '');

  const todayStr = kyivDateString(now instanceof Date ? now : new Date(now));
  const tomorrowStr = addDays(todayStr, 1);
  out.push('## Відрізки черги 2.1', '');
  out.push(`### Сьогодні (${fmtDM(todayStr)})`, '');
  const todayIvs = intervalsOf(days, todayStr);
  out.push(...(todayIvs.length ? todayIvs.map((iv) => `- ${segmentLine(iv)}`) : ['- Графіка на сьогодні немає']), '');
  out.push(`### Завтра (${fmtDM(tomorrowStr)})`, '');
  const tmIvs = intervalsOf(days, tomorrowStr);
  out.push(...(tmIvs.length ? tmIvs.map((iv) => `- ${segmentLine(iv)}`) : ['- Графік на завтра ще не опубліковано']), '');

  out.push('## Заплановані сигнали (chrome.alarms)', '');
  if (alarms?.length) {
    const sorted = [...alarms].sort((a, b) => a.scheduledTime - b.scheduledTime);
    for (const a of sorted) {
      const moment = state?.plannedMoments?.[a.name];
      const desc = moment ? ` — ${moment.events.map((e) => `T-${e.offset} ${e.zone}@${fmtHM(e.boundaryMin)}`).join(' + ')}` : '';
      out.push(`- ${fmtDMHM(a.scheduledTime)} \`${a.name}\`${desc}`);
    }
  } else out.push('- Немає запланованих сигналів.');
  out.push('');

  out.push('## Журнал', '');
  const since48h = (now instanceof Date ? now.getTime() : now) - 48 * 3600 * 1000;
  const entries = log ?? [];
  const bad = entries.filter((e) => (e.level === 'WARN' || e.level === 'ERROR') && Date.parse(e.time) >= since48h);
  const infos = entries.filter((e) => e.level === 'INFO').slice(-20);
  out.push('### WARN/ERROR за останні 48 годин', '');
  out.push(...(bad.length ? bad.map(logLine) : ['- Немає.'] ), '');
  out.push('### Останні 20 записів INFO', '');
  out.push(...(infos.length ? infos.map(logLine) : ['- Немає.']), '');

  out.push('## Сирі тіла відповідей', '');
  const src = raw?.fail ?? raw?.success;
  if (!src) out.push('Немає збережених тіл відповідей.');
  else {
    const which = raw.fail ? 'невдалої' : 'успішної';
    out.push(`Перші 2000 символів тіл останньої ${which} спроби (${fmtDMHM(src.savedAt)}).`, '');
    for (const [key, label] of [['timeSeries', 'time-series'], ['queues', 'by-type/3'], ['schedules', 'schedule/active']]) {
      out.push(`### ${label}`, '', '```', String(src[key] ?? '').slice(0, 2000), '```', '');
    }
  }
  return out.join('\n').trim() + '\n';
}
