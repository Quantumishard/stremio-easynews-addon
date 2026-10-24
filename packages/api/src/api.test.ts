import { afterEach, expect, it, vi } from 'vitest';
import { EasynewsAPI } from './api.js';

afterEach(() => vi.unstubAllGlobals());

it('uses v3 with authentication and normalizes named result fields', async () => {
  const request = vi.fn().mockResolvedValue(
    Response.json({
      data: [
        {
          hash: 'a'.repeat(41),
          id: '1234',
          fn: 'Example',
          extension: '.mkv',
          ts: 1700000000,
        },
      ],
      numPages: 1,
    })
  );
  vi.stubGlobal('fetch', request);
  const res = await new EasynewsAPI({
    username: 'user',
    password: 'pass',
  }).search({ query: 'Example' });
  const [url, options] = request.mock.calls[0];
  expect(url.pathname).toBe('/3.0/api/search');
  expect(url.searchParams.get('gps')).toBe('Example');
  expect(options.headers.get('Authorization')).toBe('Basic dXNlcjpwYXNz');
  expect(res.data[0]['0']).toBe('a'.repeat(41) + '1234');
  expect(res.data[0]['10']).toBe('Example');
});

it('stops at numPages and deduplicates overlapping pages', async () => {
  const request = vi
    .fn()
    .mockResolvedValueOnce(
      Response.json({ data: [{ '0': 'a' }, { '0': 'b' }], numPages: 2 })
    )
    .mockResolvedValueOnce(
      Response.json({ data: [{ '0': 'b' }, { '0': 'c' }], numPages: 2 })
    );
  vi.stubGlobal('fetch', request);
  const res = await new EasynewsAPI({
    username: 'user',
    password: 'pass',
  }).searchAll({ query: 'Example' });
  expect(res.data.map((file) => file['0'])).toEqual(['a', 'b', 'c']);
  expect(request).toHaveBeenCalledTimes(2);
});
