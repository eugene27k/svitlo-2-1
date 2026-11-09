// Тести текстів сповіщень, мітки, вікна і звіту (вимоги В3.7–В3.13, В4, В6)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  zoneWord, zoneDescription, zoneColor, extendedSegment,
  warnNotificationText, nowNotificationText, currentZoneNotification,
  badgeState, popupModel, buildReport, fmtDuration, timelineModel,
  queueIdChangedNotification, fetchFailureNotification, TEST_NOTIFICATION,
  TOOLBAR_TITLES,
} from '../src/texts.js';
import { validateData } from '../src/validate.js';
import { QUEUE, mergeIntervals } from '../src/schedule.js';
import { controlResponses, T } from './helpers.js';

function controlDays() {
  const v = validateData({ responses: controlResponses(), now: new Date(T(9, 0)), queueName: QUEUE.name, expectedQueueId: QUEUE.expectedId });
  return v.data.days;
}
const ev = (offset, zone, boundaryMin, date = '2026-11-09') => ({
  offset, zone, boundaryMin, boundaryEpoch: T(9, Math.floor(boundaryMin / 60), boundaryMin % 60), date,
});

test('Слова й кольори зон (В4.1)', () => {
  assert.equal(zoneWord('red'), 'червона зона');
  assert.equal(zoneWord('yellow'), 'жовта зона');
  assert.equal(zoneWord('green'), 'зелена зона');
  assert.equal(zoneColor('red'), '#D93025');
  assert.equal(zoneColor('yellow'), '#F9AB00');
  assert.equal(zoneColor('green'), '#1E8E3E');
  assert.equal(zoneColor('none'), '#80868B');
});

test('Описи зон (В3.11)', () => {
  assert.equal(zoneDescription({ zone: 'red', hasSureOff: false }), 'заплановане відключення');
  assert.equal(zoneDescription({ zone: 'red', hasSureOff: true }), 'актуальне відключення');
  assert.equal(zoneDescription({ zone: 'yellow' }), 'електропостачання можливе');
  assert.equal(zoneDescription({ zone: 'green' }), 'є світло');
});

test('В3.12: кінець відрізка до кінця доби — «24:00» без завтра, справжній кінець із завтра', () => {
  const days = controlDays();
  const last = mergeIntervals(days['2026-11-09'].slots).at(-1); // зелений 17:30–24:00
  assert.equal(extendedSegment({ date: '2026-11-09', iv: last, days }).endText, '24:00');
  // завтра: зелена 00:00–02:00, потім жовта — кінець продовжується до 02:00
  const tm = new Array(48).fill('ENABLE');
  tm[4] = 'PROBABLY_OFF'; tm[5] = 'PROBABLY_OFF'; // 02:00–03:00 жовта
  const days2 = { ...days, '2026-11-10': { slots: tm, unknownTypes: [] } };
  assert.equal(extendedSegment({ date: '2026-11-09', iv: last, days: days2 }).endText, '02:00');
});

test('Попередження за 30 хв: формати заголовка й тексту (В3.7–В3.8)', () => {
  const days = controlDays();
  const t = warnNotificationText({ event: ev(30, 'yellow', 420), days, now: new Date(T(9, 6, 30)) }); // о 06:30 про 07:00
  assert.equal(t.title, 'Черга 2.1 · через 30 хв: жовта зона');
  assert.equal(t.message, 'З 07:00 до 07:30 — електропостачання можливе. Зараз: зелена зона, є світло.');
  const t15 = warnNotificationText({ event: ev(15, 'red', 450), days, now: new Date(T(9, 7, 15)) }); // о 07:15 про 07:30
  assert.equal(t15.title, 'Черга 2.1 · через 15 хв: червона зона');
  assert.equal(t15.message, 'З 07:30 до 10:00 — заплановане відключення. Зараз: жовта зона, електропостачання можливе.');
});

test('Момент зміни: формати заголовка й тексту (В3.9–В3.10)', () => {
  const days = controlDays();
  const t = nowNotificationText({ event: ev(0, 'yellow', 420), days }); // 07:00 жовта
  assert.equal(t.title, 'Черга 2.1 · зараз: жовта зона');
  assert.equal(t.message, 'До 07:30 — електропостачання можливе. Далі: червона зона, заплановане відключення.');
  const last = nowNotificationText({ event: ev(0, 'green', 1050), days }); // 17:30 зелена до кінця доби
  assert.equal(last.title, 'Черга 2.1 · зараз: зелена зона');
  assert.equal(last.message, 'До 24:00 — є світло. Далі: графік на завтра ще не опубліковано.');
});

test('Момент зміни з завтрашнім графіком: «Далі» береться з завтра (В3.10, В3.12)', () => {
  const days = controlDays();
  const tm = new Array(48).fill('ENABLE');
  tm[0] = 'OFF'; // завтра з 00:00 червона, сьогодні до 24:00 зелена
  const days2 = { ...days, '2026-11-10': { slots: tm, unknownTypes: [] } };
  const t = nowNotificationText({ event: ev(0, 'green', 1050), days: days2 });
  assert.equal(t.message, 'До 24:00 — є світло. Далі: червона зона, заплановане відключення.');
});

test('currentZoneNotification: сповіщення про поточну зону (В3.16)', () => {
  const days = controlDays();
  const t = currentZoneNotification({ days, now: new Date(T(9, 8, 0)) });
  assert.equal(t.zone, 'red');
  assert.equal(t.title, 'Черга 2.1 · зараз: червона зона');
  assert.equal(t.message, 'До 10:00 — заплановане відключення. Далі: жовта зона, електропостачання можливе.');
  assert.equal(currentZoneNotification({ days: {}, now: new Date(T(9, 8, 0)) }), null);
});

test('Мітка: хвилини, години, порожній текст і сірі стани (В4.2–В4.4)', () => {
  const days = controlDays();
  assert.deepEqual(badgeState({ days, now: new Date(T(9, 6, 40)), lastSuccessAt: T(9, 6, 0) }), { color: '#1E8E3E', text: '20хв', blink: null });
  assert.deepEqual(badgeState({ days, now: new Date(T(9, 7, 10)), lastSuccessAt: T(9, 7, 0) }), { color: '#F9AB00', text: '20хв', blink: null }); // 07:10 — жовта зона, до 07:30 червона
  assert.deepEqual(badgeState({ days, now: new Date(T(9, 8, 0)), lastSuccessAt: T(9, 7, 30) }), { color: '#D93025', text: '2г', blink: null }); // до 10:00
  assert.deepEqual(badgeState({ days, now: new Date(T(9, 18, 0)), lastSuccessAt: T(9, 17, 0) }), { color: '#1E8E3E', text: '', blink: null }); // змін більше нема
  assert.deepEqual(badgeState({ days: {}, now: new Date(T(9, 8, 0)), lastSuccessAt: T(9, 7, 0) }), { color: '#80868B', text: '?', blink: null }); // немає графіка на сьогодні
  assert.deepEqual(badgeState({ days: null, now: new Date(T(9, 8, 0)), lastSuccessAt: null }), { color: '#80868B', text: '?', blink: null });
});

test('Мітка: наступна зміна опівночі, якщо завтра інша зона (В4.2)', () => {
  const days = controlDays();
  const tm = new Array(48).fill('ENABLE');
  tm[0] = 'OFF';
  const days2 = { ...days, '2026-11-10': { slots: tm, unknownTypes: [] } };
  assert.deepEqual(badgeState({ days: days2, now: new Date(T(9, 18, 0)), lastSuccessAt: T(9, 17, 0) }), { color: '#1E8E3E', text: '6г', blink: null });
});

test('Мітка: дані старші за 3 години — текст «!» і колір зони (В4.5)', () => {
  const days = controlDays();
  assert.deepEqual(badgeState({ days, now: new Date(T(9, 8, 0)), lastSuccessAt: T(9, 4, 30) }), { color: '#D93025', text: '!', blink: null });
});

test('Мітка: за 15 хв до зміни — об’єкт моргання з кольором наступної зони (В4.11)', () => {
  const days = controlDays(); // 07:00–07:30 жовта, далі 07:30 червона
  assert.deepEqual(badgeState({ days, now: new Date(T(9, 7, 16)), lastSuccessAt: T(9, 7, 0) }), { color: '#F9AB00', text: '14хв', blink: { color: '#D93025', until: T(9, 7, 30) } });
  assert.deepEqual(badgeState({ days, now: new Date(T(9, 7, 15)), lastSuccessAt: T(9, 7, 0) }), { color: '#F9AB00', text: '15хв', blink: { color: '#D93025', until: T(9, 7, 30) } }); // рівно 15 хв — вікно вже активне
  assert.deepEqual(badgeState({ days, now: new Date(T(9, 7, 10)), lastSuccessAt: T(9, 7, 0) }), { color: '#F9AB00', text: '20хв', blink: null }); // понад 15 хв — моргання нема
});

test('Мітка: моргання опівночі на зону з завтрашнього графіка (В4.11)', () => {
  const days = controlDays();
  const tm = new Array(48).fill('ENABLE');
  tm[0] = 'OFF'; // завтра з 00:00 червона, сьогодні до 24:00 зелена
  const days2 = { ...days, '2026-11-10': { slots: tm, unknownTypes: [] } };
  assert.deepEqual(badgeState({ days: days2, now: new Date(T(9, 23, 46)), lastSuccessAt: T(9, 23, 0) }), { color: '#1E8E3E', text: '14хв', blink: { color: '#D93025', until: T(10, 0, 0) } });
});

test('Мітка: застарілі дані вимикають моргання (В4.11, В4.5)', () => {
  const days = controlDays();
  assert.deepEqual(badgeState({ days, now: new Date(T(9, 7, 16)), lastSuccessAt: T(9, 3, 30) }), { color: '#F9AB00', text: '!', blink: null }); // «!» і колір поточної зони
});

test('Вікно: рядки поточної/наступної зони, відрізки, оновлення, звірка (В4.7)', () => {
  const days = controlDays();
  const state = {
    version: 1,
    queue: { name: '2.1', expectedId: 16, foundId: 16, verifiedAt: T(9, 7, 15) },
    days,
    lastAttemptAt: T(9, 7, 15), lastAttemptOk: true, lastSuccessAt: T(9, 7, 15),
    consecutiveFailures: 0, checks: [{ code: 'П1', level: 'pass', message: 'ok', expected: '200', got: '200', details: {} }],
    nextUpdateAt: T(9, 8, 15),
  };
  const m = popupModel({ state, now: new Date(T(9, 8, 0)) });
  assert.equal(m.title, 'Черга 2.1');
  assert.equal(m.currentLine, 'Зараз: червона зона — заплановане відключення, до 10:00');
  assert.equal(m.nextLine, 'Далі: жовта зона з 10:00 до 10:30');
  assert.equal(m.todayList[2], '07:30–10:00 · червона · заплановане відключення');
  assert.equal(m.todayList.length, 9);
  assert.equal(m.tomorrowNote, 'Графік на завтра ще не опубліковано');
  assert.equal(m.updatedLine, 'Оновлено о 07:15 · наступне оновлення о 08:15');
  assert.equal(m.verifyLine, 'Черга 2.1 = внутрішній номер 16 (звірено о 07:15)');
  assert.equal(m.checksLine, 'Перевірки: усе гаразд');
  assert.deepEqual(m.unknownTypeNotes, []);
});

test('Вікно: «немає даних» без графіка на сьогодні (В4.4, П11)', () => {
  const state = { queue: { name: '2.1', expectedId: 16, foundId: null, verifiedAt: null }, days: {}, checks: [], lastAttemptAt: null, lastSuccessAt: null, nextUpdateAt: null };
  const m = popupModel({ state, now: new Date(T(9, 8, 0)) });
  assert.equal(m.currentLine, 'Зараз: немає даних');
});

test('Вікно: підсумок перевірок і список (В4.7)', () => {
  const mk = (code, level) => ({ code, level, message: `повідомлення ${code}`, expected: 'e', got: 'g', details: {} });
  const state = { queue: { name: '2.1', expectedId: 16, foundId: 16, verifiedAt: T(9, 7) }, days: {}, lastAttemptAt: T(9, 7), lastSuccessAt: T(9, 7), checks: [mk('П5', 'warn'), mk('П10', 'warn'), mk('П8', 'pass')], nextUpdateAt: null };
  const m = popupModel({ state, now: new Date(T(9, 8)) });
  assert.equal(m.checksLine, 'Перевірки: 2 попереджень, 0 помилок');
  assert.ok(m.checksList.some((l) => l.startsWith('П10') && l.includes('попередження')));
});

test('Вікно: напис про невідомий стан (П10)', () => {
  const days = controlDays();
  days['2026-11-09'].unknownTypes = ['MAYBE_OFF'];
  const state = { queue: { foundId: 16, verifiedAt: T(9, 7) }, days, checks: [], lastAttemptAt: T(9, 7), lastSuccessAt: T(9, 7), nextUpdateAt: null };
  const m = popupModel({ state, now: new Date(T(9, 8)) });
  assert.deepEqual(m.unknownTypeNotes, ['У графіку невідомий стан «MAYBE_OFF» — показано як жовту зону']);
});

test('Тривалість відрізка: формат «год/хв» для смуг і підсумків', () => {
  assert.equal(fmtDuration(30), '30 хв');
  assert.equal(fmtDuration(60), '1 год');
  assert.equal(fmtDuration(90), '1 год 30 хв');
  assert.equal(fmtDuration(150), '2 год 30 хв');
  assert.equal(fmtDuration(240), '4 год');
});

test('Смуги доби: частки зон, межі й підсумки тривалостей', () => {
  const days = controlDays();
  const tl = timelineModel({ state: { days }, now: new Date(T(9, 8, 0)) });
  // смуги завжди видимі під заголовками «Сьогодні»/«Завтра» — власні назви не потрібні
  assert.equal('title' in tl.today, false);
  assert.equal('title' in tl.tomorrow, false);
  assert.ok(tl.tomorrow.empty, 'графіка на завтра немає');
  assert.deepEqual(tl.tomorrow.bars, []);
  assert.deepEqual(tl.tomorrow.legend, []);

  assert.equal(tl.today.empty, false);
  assert.equal(tl.today.bars.length, 9);
  const red = tl.today.bars[2]; // 07:30–10:00 червона
  assert.equal(red.zone, 'red');
  assert.equal(red.startMin, 450);
  assert.equal(red.endMin, 600);
  assert.ok(Math.abs(red.pct - (150 / 1440) * 100) < 1e-9);
  assert.equal(red.tooltip, '07:30–10:00 · червона · заплановане відключення · 2 год 30 хв');
  const sum = tl.today.bars.reduce((a, b) => a + b.pct, 0);
  assert.ok(Math.abs(sum - 100) < 1e-9, 'частки покривають усю добу');

  assert.deepEqual(tl.today.legend, [
    { zone: 'red', minutes: 300, text: '5 год' },
    { zone: 'yellow', minutes: 120, text: '2 год' },
    { zone: 'green', minutes: 1020, text: '17 год' },
  ]);
  assert.ok(Math.abs(tl.nowPct - (480 / 1440) * 100) < 1e-9, 'позначка «зараз» на 08:00');
});

test('Смуги доби: день без даних — empty, без смуг і підсумків', () => {
  const tl = timelineModel({ state: { days: {} }, now: new Date(T(9, 8, 0)) });
  assert.ok(tl.today.empty);
  assert.deepEqual(tl.today.bars, []);
  assert.deepEqual(tl.today.legend, []);
  const none = timelineModel({ state: null, now: new Date(T(9, 8, 0)) });
  assert.ok(none.today.empty && none.tomorrow.empty);
});

test('Спеціальні сповіщення: П5, В2.15, тестове (В2.5, В2.15, В4.9)', () => {
  assert.deepEqual(queueIdChangedNotification(20), {
    title: 'Черга 2.1: внутрішній номер на сайті змінився з 16 на 20',
    message: 'Черга 2.1: внутрішній номер на сайті змінився з 16 на 20',
  });
  const f = fetchFailureNotification(T(9, 5, 30));
  assert.equal(f.title, 'Черга 2.1: не вдалося оновити графік');
  assert.equal(f.message, 'Останнє успішне оновлення: 09.11 о 05:30. Відкрийте розширення, щоб скопіювати звіт.');
  assert.equal(fetchFailureNotification(null).message, 'Останнє успішне оновлення: —. Відкрийте розширення, щоб скопіювати звіт.');
  assert.equal(TEST_NOTIFICATION.title, 'Черга 2.1 · тест');
  assert.equal(TEST_NOTIFICATION.message, 'Якщо ви це бачите, сповіщення працюють.');
});

test('Звіт: перший рядок точний, розділи в порядку В6.6', () => {
  const days = controlDays();
  const state = {
    version: 1,
    queue: { name: '2.1', expectedId: 16, foundId: 16, verifiedAt: T(9, 7, 15) },
    days,
    lastAttemptAt: T(9, 7, 15), lastAttemptOk: true, lastSuccessAt: T(9, 7, 15),
    consecutiveFailures: 0,
    checks: [{ code: 'П1', level: 'pass', message: 'ок', expected: '200', got: '200', details: { url: 'u' } }],
    notifiedZone: 'red', nextUpdateAt: T(9, 8, 15), plannedMoments: {},
  };
  const log = [
    { time: '2026-11-09T07:15:00+02:00', level: 'WARN', stage: 'VALIDATE', check: 'П10', message: 'невідомий тип X', details: { got: 'X' } },
    { time: '2026-11-09T07:15:01+02:00', level: 'INFO', stage: 'FETCH', check: '', message: 'запит', details: {} },
  ];
  const raw = { success: { timeSeries: '[1]', queues: '[2]', schedules: '[3]', savedAt: T(9, 7, 15) }, fail: null };
  const report = buildReport({
    extensionVersion: '1.0.0',
    userAgent: 'Mozilla/5.0 Test',
    systemTimeZone: 'Europe/Berlin',
    now: new Date(T(9, 8, 0)),
    state, log,
    alarms: [{ name: 'svitlo-notify-0', scheduledTime: T(9, 9, 30) }],
    raw,
  });
  const firstLine = 'Звіт розширення «Світло 2.1» для налагодження. Очікувана поведінка описана в PRD.md.';
  assert.ok(report.startsWith(firstLine + '\n'), report.slice(0, 80));
  const order = [
    'Версія розширення', 'navigator.userAgent', 'Часовий пояс системи', 'Час формування звіту',
    'Еталон черги', 'Знайдений внутрішній номер',
    'Остання спроба', 'Останнє успішне оновлення',
    'Перевірки', 'Відрізки черги 2.1',
    'Заплановані сигнали', 'Журнал', 'Сирі тіла відповідей',
  ];
  let prev = -1;
  for (const marker of order) {
    const i = report.indexOf(marker);
    assert.ok(i > prev, `«${marker}» має йти після попереднього розділу`);
    prev = i;
  }
  assert.ok(report.includes('Mozilla/5.0 Test'));
  assert.ok(report.includes('Europe/Berlin'));
  assert.ok(report.includes('09.11.2026 08:00'));
  assert.ok(report.includes('| П1 |'));
  assert.ok(report.includes('07:30–10:00'));
  assert.ok(report.includes('svitlo-notify-0'));
  assert.ok(report.includes('WARN'));
  assert.ok(report.includes('невідомий тип X'));
});

test('Звіт: сирі тіла беруться з невдалої спроби, якщо вона була (В6.6.9)', () => {
  const state = { queue: { foundId: 16, verifiedAt: T(9, 7) }, days: {}, checks: [], lastAttemptAt: T(9, 8), lastAttemptOk: false, lastSuccessAt: T(9, 7) };
  const raw = { success: { timeSeries: '{"ok":1}', queues: '[]', schedules: '[]', savedAt: T(9, 7) }, fail: { timeSeries: 'BAD1', queues: 'BAD2', schedules: 'BAD3', savedAt: T(9, 8) } };
  const report = buildReport({ extensionVersion: '1.0', userAgent: 'UA', systemTimeZone: 'UTC', now: new Date(T(9, 9)), state, log: [], alarms: [], raw });
  assert.ok(report.includes('BAD1') && report.includes('BAD3'));
  assert.ok(!report.includes('{"ok":1}'));
});

test('Звіт: уривок тіла обрізається до 2000 символів (В6.6.9)', () => {
  const long = 'x'.repeat(5000);
  const state = { queue: { foundId: 16, verifiedAt: T(9, 7) }, days: {}, checks: [], lastAttemptAt: T(9, 8), lastAttemptOk: false, lastSuccessAt: T(9, 7) };
  const raw = { success: null, fail: { timeSeries: long, queues: '[]', schedules: '[]', savedAt: T(9, 8) } };
  const report = buildReport({ extensionVersion: '1.0', userAgent: 'UA', systemTimeZone: 'UTC', now: new Date(T(9, 9)), state, log: [], alarms: [], raw });
  assert.ok(report.includes('x'.repeat(2000)));
  assert.ok(!report.includes('x'.repeat(2001)));
});

test('TOOLBAR_TITLES: підказки всіх іконок шапки — непорожні й унікальні (В4.7)', () => {
  assert.deepEqual(
    Object.keys(TOOLBAR_TITLES).sort(),
    ['copyReport', 'openSite', 'refresh', 'sounds', 'testNotification'],
  );
  for (const [k, v] of Object.entries(TOOLBAR_TITLES)) {
    assert.ok(typeof v === 'string' && v.length > 0, `підказка для ${k}`);
  }
  const values = Object.values(TOOLBAR_TITLES);
  assert.equal(new Set(values).size, values.length, 'підказки не повторюються');
});
