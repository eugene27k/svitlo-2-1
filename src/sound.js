// Звуки сповіщень про зміну зони (В3.18–В3.20): вибір звуку та його «нотний запис».
// Звук синтезується Web Audio API у offscreen-документі — аудіофайлів і зовнішніх ресурсів немає.

/**
 * Специфікації звуків: ноти { freq: Гц, start/dur: секунди, type: форма хвилі, gain: 0–1 }.
 * green — приємний мажорний акорд C5–E5–G5 (синусоїди, м’яка атака);
 * yellow — нейтральне попередження двома однотонними гудками D5;
 * red — тривожний двотональний сигнал із чотирьох імпульсів;
 * test — усі три зони підряд для перевірки у вікні розширення.
 */
export const SOUNDS = {
  green: {
    notes: [
      { freq: 523.25, start: 0.00, dur: 0.16, type: 'sine', gain: 0.22 },
      { freq: 659.25, start: 0.12, dur: 0.16, type: 'sine', gain: 0.22 },
      { freq: 783.99, start: 0.24, dur: 0.28, type: 'sine', gain: 0.22 },
    ],
  },
  yellow: {
    notes: [
      { freq: 587.33, start: 0.00, dur: 0.13, type: 'triangle', gain: 0.20 },
      { freq: 587.33, start: 0.22, dur: 0.13, type: 'triangle', gain: 0.20 },
    ],
  },
  red: {
    notes: [
      { freq: 840, start: 0.00, dur: 0.15, type: 'sawtooth', gain: 0.15 },
      { freq: 600, start: 0.19, dur: 0.15, type: 'sawtooth', gain: 0.15 },
      { freq: 840, start: 0.38, dur: 0.15, type: 'sawtooth', gain: 0.15 },
      { freq: 600, start: 0.57, dur: 0.15, type: 'sawtooth', gain: 0.15 },
    ],
  },
};

SOUNDS.test = {
  notes: [
    ...SOUNDS.green.notes,
    ...SOUNDS.yellow.notes.map((n) => ({ ...n, start: n.start + 0.7 })),
    ...SOUNDS.red.notes.map((n) => ({ ...n, start: n.start + 1.5 })),
  ],
};

/** Тривалість звуку в мілісекундах — щоб знати, коли закривати AudioContext. */
export function soundDurationMs(id) {
  const notes = SOUNDS[id]?.notes ?? [];
  return Math.round(Math.max(0, ...notes.map((n) => n.start + n.dur)) * 1000);
}

/**
 * Звук для сповіщення про зону (В3.18, В3.20):
 * попередження за 15 хв, момент зміни («now») і сповіщення після пробудження
 * («reconcile») — звук кольору зони; попередження за 30 хв — без звуку.
 * @returns {'red'|'yellow'|'green'|null}
 */
export function soundForSend(send) {
  if (!['red', 'yellow', 'green'].includes(send?.zone)) return null;
  if (send.kind === 'now' || send.kind === 'reconcile') return send.zone;
  if (send.kind === 'warn' && (send.offset ?? 30) <= 15) return send.zone;
  return null;
}
