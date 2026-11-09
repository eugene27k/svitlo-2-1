// Порівняння двох графіків черги (вимога В5). Чисті функції.
import { kyivDateString, addDays, fmtHM, fmtDM, epochForMinute, zoneOfType, mergeIntervals } from './schedule.js';
import { zoneWord } from './texts.js';

/**
 * @returns {{changed: boolean, rows: Array, lines: string[], extraCount: number,
 *            tomorrowAppeared: boolean, tomorrowDate: string|null}}
 */
export function diffGraphs({ oldDays, newDays, now }) {
  const todayStr = kyivDateString(now);
  const rows = [];
  if (oldDays && newDays) {
    for (const date of Object.keys(newDays)) {
      if (!(date in oldDays) || date < todayStr) continue;
      const a = oldDays[date].slots;
      const b = newDays[date].slots;
      let run = null;
      for (let s = 0; s < 48; s++) {
        const slotEnd = epochForMinute(date, (s + 1) * 30); // В5.2: лише проміжки, що не закінчилися
        if (slotEnd > now.getTime() && a[s] !== b[s]) {
          if (run && run.endMin === s * 30 && run.fromType === a[s] && run.toType === b[s]) {
            run.endMin += 30;
          } else {
            run = { date, startMin: s * 30, endMin: (s + 1) * 30, fromType: a[s], toType: b[s] };
            rows.push(run);
          }
        } else {
          run = null;
        }
      }
    }
  }

  // В5.6: графік на завтрашню дату з'явився вперше (були старі дані, завтра в них не було)
  const tomorrow = addDays(todayStr, 1);
  const tomorrowAppeared = Boolean(oldDays && newDays?.[tomorrow] && !(tomorrow in oldDays));

  rows.sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : x.startMin - y.startMin));
  const lines = rows.slice(0, 3).map(rowLine);
  const extraCount = Math.max(0, rows.length - 3);
  return { changed: rows.length > 0, rows, lines, extraCount, tomorrowAppeared, tomorrowDate: tomorrowAppeared ? tomorrow : null };
}

function rowLine(row) {
  const pair = pairText(row.fromType, row.toType);
  return `${fmtDM(row.date)} ${fmtHM(row.startMin)}–${fmtHM(row.endMin)}: ${pair}`;
}

/** Пара зон у рядку зміни (В5.4–В5.5) */
function pairText(fromType, toType) {
  const pair = `${fromType}->${toType}`;
  if (pair === 'OFF->SURE_OFF') return 'заплановане → актуальне відключення';
  if (pair === 'SURE_OFF->OFF') return 'актуальне → заплановане відключення';
  return `${zoneWord(zoneOfType(fromType))} → ${zoneWord(zoneOfType(toType))}`;
}

/** Сповіщення про зміну графіка (В5.3–В5.5) або null */
export function graphChangeNotification(diff) {
  if (!diff.changed) return null;
  const parts = [...diff.lines];
  if (diff.extraCount > 0) parts.push(`і ще ${diff.extraCount} змін`);
  return { title: 'Черга 2.1 · графік змінився', message: parts.join('\n') };
}

/** Сповіщення про першу появу графіка на завтра (В5.6–В5.7) */
export function tomorrowAppearedNotification({ date, days }) {
  const ivs = mergeIntervals(days[date].slots);
  const fmt = (zone) => ivs.filter((iv) => iv.zone === zone).map((iv) => `${fmtHM(iv.startMin)}–${fmtHM(iv.endMin)}`).join(', ');
  const red = fmt('red');
  const yellow = fmt('yellow');
  let message;
  if (!red && !yellow) message = 'Відключень для черги 2.1 не заплановано.';
  else {
    const parts = [];
    if (red) parts.push(`Червона: ${red}.`);
    if (yellow) parts.push(`Жовта: ${yellow}.`);
    message = parts.join(' ');
  }
  return { title: `Черга 2.1 · з’явився графік на ${fmtDM(date)}`, message };
}
