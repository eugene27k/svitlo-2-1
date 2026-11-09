// Програвач звуків сповіщень (В3.19): синтез Web Audio API за нотами з src/sound.js.
// Документ живе, поки приходять звуки, і закривається сам через 30 с тиші.
import { SOUNDS, soundDurationMs } from './sound.js';

const IDLE_CLOSE_MS = 30_000;
let idleTimer = null;

function scheduleIdleClose() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => window.close(), IDLE_CLOSE_MS);
}

function play(id) {
  const spec = SOUNDS[id];
  const ctx = new AudioContext();
  ctx.resume().catch(() => {}); // на випадок призупиненого контексту
  const t0 = ctx.currentTime + 0.02;
  for (const n of spec.notes) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = n.type;
    osc.frequency.value = n.freq;
    const t = t0 + n.start;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(n.gain, t + 0.008); // м'яка атака без клацання
    gain.gain.linearRampToValueAtTime(0, t + n.dur); // і м'яке затухання
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + n.dur + 0.02);
  }
  setTimeout(() => ctx.close(), soundDurationMs(id) + 200);
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== 'play-sound' || !SOUNDS[msg.sound]) return false;
  play(msg.sound);
  scheduleIdleClose();
  sendResponse({ ok: true });
  return false;
});
