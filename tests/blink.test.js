// Тести драйвера моргання мітки (В4.11) — фальшиві таймери, без chrome.*.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { ensureBlink, stopBlink, BLINK_PERIOD_MS } from '../src/blink.js';

// Node 22: у mock.timers лише синхронний tick — прокручуємо мікрозавдання вручну
const advance = async (ms) => {
  mock.timers.tick(ms);
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

test('Моргання: перемикає колір щосекунди і завершує на зміні (В4.11)', async () => {
  mock.timers.enable({ apis: ['setInterval', 'Date'] });
  mock.timers.setTime(0);
  try {
    const colors = [];
    let ended = 0;
    ensureBlink({
      colorA: '#F9AB00', colorB: '#D93025', until: 5 * 1000, // вікно 5 с
      setColor: async (c) => colors.push(c),
      onEnd: async () => { ended += 1; },
    });
    for (let i = 1; i <= 5; i++) await advance(BLINK_PERIOD_MS);
    assert.deepEqual(colors, ['#D93025', '#F9AB00', '#D93025', '#F9AB00']); // перше перемикання — наступна зона
    assert.equal(ended, 1, 'на зміні зони — одне завершення');
    await advance(3 * BLINK_PERIOD_MS);
    assert.equal(colors.length, 4, 'після завершення перемикань нема');
  } finally {
    stopBlink();
    mock.timers.reset();
  }
});

test('Моргання: повторний ensureBlink оновлює кольори без другого інтервалу', async () => {
  mock.timers.enable({ apis: ['setInterval', 'Date'] });
  mock.timers.setTime(0);
  try {
    const colors = [];
    const p = (colorA, colorB) => ({ colorA, colorB, until: 60 * 1000, setColor: async (c) => colors.push(c), onEnd: async () => {} });
    ensureBlink(p('#1E8E3E', '#F9AB00'));
    await advance(BLINK_PERIOD_MS); // жовта
    ensureBlink(p('#1E8E3E', '#D93025')); // графік оновився — наступна тепер червона
    await advance(BLINK_PERIOD_MS); // зелена (фаза 0), потім:
    await advance(BLINK_PERIOD_MS); // червона з нових параметрів
    assert.deepEqual(colors, ['#F9AB00', '#1E8E3E', '#D93025']);
  } finally {
    stopBlink();
    mock.timers.reset();
  }
});

test('stopBlink: інтервал зупиняється, setColor більше не викликається', async () => {
  mock.timers.enable({ apis: ['setInterval', 'Date'] });
  mock.timers.setTime(0);
  try {
    const colors = [];
    ensureBlink({ colorA: 'A', colorB: 'B', until: 60 * 1000, setColor: async (c) => colors.push(c), onEnd: async () => {} });
    await advance(BLINK_PERIOD_MS);
    stopBlink();
    await advance(3 * BLINK_PERIOD_MS);
    assert.deepEqual(colors, ['B']);
  } finally {
    mock.timers.reset();
  }
});
