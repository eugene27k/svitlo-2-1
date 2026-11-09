// Запити до трьох адрес сайту (розділ 2 PRD): 20 секунд, без кешу.
// Викликається лише з фонового скрипту (service worker) — CORS не діє.

export const URLS = Object.freeze({
  timeSeries: 'https://off.energy.mk.ua/api/schedule/time-series',
  queues: 'https://off.energy.mk.ua/api/outage-queue/by-type/3',
  schedules: 'https://off.energy.mk.ua/api/v2/schedule/active',
});

export const FETCH_TIMEOUT_MS = 20_000;

/** Один запит: { url, status, bodyText, durationMs, error } — без винятків */
export async function fetchOne(url, { timeoutMs = FETCH_TIMEOUT_MS, fetchImpl = fetch } = {}) {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { cache: 'no-store', signal: controller.signal }); // В1.3
    const bodyText = await res.text();
    return { url, status: res.status, bodyText, durationMs: Date.now() - started, error: null };
  } catch (e) {
    const message = e?.name === 'AbortError' ? `перевищено час очікування ${timeoutMs} мс` : String(e?.message ?? e);
    return { url, status: null, bodyText: null, durationMs: Date.now() - started, error: message };
  } finally {
    clearTimeout(timer);
  }
}

/** Усі три адреси паралельно */
export async function fetchAll(opts = {}) {
  const [timeSeries, queues, schedules] = await Promise.all([
    fetchOne(URLS.timeSeries, opts),
    fetchOne(URLS.queues, opts),
    fetchOne(URLS.schedules, opts),
  ]);
  return { timeSeries, queues, schedules };
}
