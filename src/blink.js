// Драйвер моргання мітки значка (В4.11): протягом останніх 15 хвилин до зміни зони
// колір перемикається між поточною та наступною зоною приблизно раз на секунду.
// Виклики setColor (chrome.action) скидають таймаут простою service worker'а,
// тож інтервал живе все вікно; якщо worker усе ж перезапустився — щохвилинний
// tick (В4.6) викликає ensureBlink знову.

export const BLINK_PERIOD_MS = 1000;

let timer = null;
let params = null;
let phase = 0;

/**
 * Увімкнути моргання. Повторні виклики лише оновлюють параметри (кольори,
 * кінець вікна), не створюючи другий інтервал. Перше перемикання — колір
 * наступної зони (colorB).
 */
export function ensureBlink({ colorA, colorB, until, setColor, onEnd }) {
  params = { colorA, colorB, until, setColor, onEnd };
  if (timer != null) return;
  phase = 0;
  timer = setInterval(() => step().catch(() => stopBlink()), BLINK_PERIOD_MS);
}

async function step() {
  if (Date.now() >= params.until) {
    stopBlink();
    await params.onEnd(); // зміна настала — викликач виставить сталий колір нової зони
    return;
  }
  phase ^= 1;
  await params.setColor(phase ? params.colorB : params.colorA);
}

/** Зупинити моргання; колір після зупинки виставляє викликач */
export function stopBlink() {
  if (timer == null) return;
  clearInterval(timer);
  timer = null;
}
