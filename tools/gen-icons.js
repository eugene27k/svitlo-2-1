// Генератор іконок розширення: прості кольорові кружечки (PRD 4.8).
// Запуск: node tools/gen-icons.js — створює icons/*.png у репозиторії.
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'icons');

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

function makePng(size, draw) {
  const raw = Buffer.alloc(size * (size * 4 + 1)); // рядок + байт фільтра 0
  let p = 0;
  for (let y = 0; y < size; y++) {
    raw[p++] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = draw(x + 0.5, y + 0.5, size);
      raw[p++] = r; raw[p++] = g; raw[p++] = b; raw[p++] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // глибина 8 біт
  ihdr[9] = 6;  // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Кружечок: основний колір із світлим центром і згладженим краєм */
function circleDrawer(main, light) {
  return (x, y, size) => {
    const c = size / 2;
    const r = size / 2 - Math.max(0.5, size * 0.03);
    const d = Math.hypot(x - c, y - c);
    const alpha = Math.max(0, Math.min(1, r - d + 0.5));
    if (alpha <= 0) return [0, 0, 0, 0];
    const col = d <= r * 0.55 ? light : main;
    return [col[0], col[1], col[2], Math.round(alpha * 255)];
  };
}

const lighten = ([r, g, b], f) => [Math.round(r + (255 - r) * f), Math.round(g + (255 - g) * f), Math.round(b + (255 - b) * f)];

const ICONS = {
  // значок розширення — нейтральний сірий
  icon: circleDrawer([0x5f, 0x63, 0x68], lighten([0x5f, 0x63, 0x68], 0.55)),
  // значки сповіщень — кольори зон (В4.1)
  red: circleDrawer([0xd9, 0x30, 0x25], lighten([0xd9, 0x30, 0x25], 0.35)),
  yellow: circleDrawer([0xf9, 0xab, 0x00], lighten([0xf9, 0xab, 0x00], 0.4)),
  green: circleDrawer([0x1e, 0x8e, 0x3e], lighten([0x1e, 0x8e, 0x3e], 0.4)),
  gray: circleDrawer([0x80, 0x86, 0x8b], lighten([0x80, 0x86, 0x8b], 0.45)),
};

mkdirSync(OUT_DIR, { recursive: true });
for (const size of [16, 32, 48, 128]) {
  writeFileSync(join(OUT_DIR, `icon${size}.png`), makePng(size, ICONS.icon));
}
for (const name of ['red', 'yellow', 'green', 'gray']) {
  writeFileSync(join(OUT_DIR, `${name}.png`), makePng(128, ICONS[name]));
}
console.log(`Іконки створено в ${OUT_DIR}`);
