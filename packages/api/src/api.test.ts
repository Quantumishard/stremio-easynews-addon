import { afterEach, expect, it, vi } from 'vitest';
import { EasynewsAPI } from './api.js';

afterEach(() => vi.restoreAllMocks());
afterEach(() => vi.unstubAllGlobals());

it('uses v3 and normalizes named fields without losing the NZB signature', async () => {
  const fetcher = vi.fn(async () =>
    Response.json({
      data: [
        {
          hash: 'a'.repeat(41),
          id: '1234',
          fn: 'Concert',
          extension: '.mkv',
          timestamp: 1700000000,
          size: 123456,
          prettySize: '120 KB',
          sig: 'fixture-signature',
          yres: 2160,
          password: false,
        },
      ],
      numPages: 1,
    })
  );
  vi.stubGlobal('fetch', fetcher);
  const result = await api().search({ query: 'coachella' });
  const [url, options] = fetcher.mock.calls[0] as unknown as [URL, RequestInit];
  expect(url.pathname).toBe('/3.0/api/search');
  expect(url.searchParams.get('gps')).toBe('coachella');
  expect((options.headers as Headers).get('Authorization')).toMatch(/^Basic /);
  expect(result.data[0]).toMatchObject({
    '0': 'a'.repeat(41) + '1234',
    '10': 'Concert',
    '11': '.mkv',
    '5': '2023-11-14T22:13:20.000Z',
    rawSize: 123456,
    sig: 'fixture-signature',
  });
  expect(result.downURL).toBe('https://members.easynews.com/dl');
  expect(result.dlFarm).toBe('auto');
  expect(result.dlPort).toBe('auto');
});

it.each([undefined, 'bad-date'])(
  'normalizes missing or invalid post dates (%s)',
  async (posted) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({ data: [{ '0': 'id', '5': posted }], numPages: 1 })
      )
    );
    const result = await api().search({ query: 'coachella' });
    expect(result.data[0]['5']).toBe('1970-01-01T00:00:00.000Z');
  }
);
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
    expect(url.pathname).toBe('/3.0/api/search');
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
  expect(AbortSignal.timeout).toHaveBeenCalledWith(8000);
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
