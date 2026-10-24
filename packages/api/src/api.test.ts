import { afterEach, expect, it, vi } from 'vitest';
import { EasynewsAPI } from './api.js';

afterEach(() => vi.restoreAllMocks());
afterEach(() => vi.unstubAllGlobals());
const api = () =>
  new EasynewsAPI({ username: 'fixture-user', password: 'fixture-password' });
function fixture(page: number, numPages = 3) {
  return {
    data: Array.from({ length: 100 }, (_, i) => ({
      '0': String((page - 1) * 100 + i),
    })),
    numPages,
  };
}

it('collects more than 100 results and requests consistent 100-result pages', async () => {
  const fetcher = vi.fn(async (url: URL) => {
    expect(url.searchParams.get('pby')).toBe('100');
    return Response.json(fixture(Number(url.searchParams.get('pno'))));
  });
  vi.stubGlobal('fetch', fetcher);
  const result = await api().searchAll({ query: 'concert' });
  expect(result.data).toHaveLength(300);
  expect(result.returned).toBe(300);
  expect(fetcher).toHaveBeenCalledTimes(3);
});

it('caps broad searches at 1000 with no more than three simultaneous requests', async () => {
  let active = 0,
    peak = 0;
  const signals = new Set();
  const fetcher = vi.fn(async (url: URL, init: RequestInit) => {
    signals.add(init.signal);
    peak = Math.max(peak, ++active);
    await Promise.resolve();
    active--;
    return Response.json(fixture(Number(url.searchParams.get('pno')), 500));
  });
  vi.stubGlobal('fetch', fetcher);
  expect((await api().searchAll({ query: 'concert' })).data).toHaveLength(1000);
  expect(fetcher).toHaveBeenCalledTimes(10);
  expect(peak).toBe(3);
  expect(signals.size).toBe(1);
});

it('keeps successful pages and removes overlapping IDs when a later request fails', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: URL) => {
      const page = Number(url.searchParams.get('pno'));
      if (page === 2) throw new Error('fixture failure');
      return Response.json({
        data: [{ '0': 'shared' }, { '0': String(page) }],
        numPages: 3,
      });
    })
  );
  expect(
    (await api().searchAll({ query: 'concert' })).data.map((f) => f['0'])
  ).toEqual(['shared', '1', '3']);
});

it('returns earlier results when the shared deadline expires', async () => {
  const controller = new AbortController();
  vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: URL) => {
      if (url.searchParams.get('pno') === '1')
        return Response.json(fixture(1, 50));
      controller.abort();
      throw new DOMException('fixture timeout', 'TimeoutError');
    })
  );
  expect((await api().searchAll({ query: 'concert' })).data).toHaveLength(100);
  expect(AbortSignal.timeout).toHaveBeenCalledWith(12000);
});

it('honors a smaller result limit', async () => {
  const fetcher = vi.fn(async (url: URL) =>
    Response.json(fixture(Number(url.searchParams.get('pno'))))
  );
  vi.stubGlobal('fetch', fetcher);
  expect(
    (await api().searchAll({ query: 'concert', maxResults: 150 })).data
  ).toHaveLength(150);
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it('does not request additional pages for empty results', async () => {
  const fetcher = vi.fn(async () => Response.json({ data: [], numPages: 10 }));
  vi.stubGlobal('fetch', fetcher);
  expect((await api().searchAll({ query: 'concert' })).data).toHaveLength(0);
  expect(fetcher).toHaveBeenCalledTimes(1);
});
