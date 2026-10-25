import { afterEach, expect, it, vi } from 'vitest';
import { addonInterface } from './addon.js';

afterEach(() => vi.unstubAllGlobals());

it('returns v3 named catalog fields with HTTP URLs, public thumbnails and NZB identities', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: URL) => {
      expect(url.pathname).toBe('/3.0/api/search');
      return Response.json({
        numPages: 1,
        data: [
          {
            hash: 'a'.repeat(41),
            id: '1234',
            fn: 'Coachella Concert',
            extension: '.mkv',
            timestamp: 1700000000,
            sig: 'fixture-signature',
            size: 123456,
          },
        ],
      });
    })
  );
  const result = await addonInterface.get(
    'meta',
    'tv',
    'easynews-plus:Coachella',
    {},
    { username: 'fixture-user', password: 'fixture-password' }
  );
  const video = result.meta.videos[0];
  expect(video.id).toBe('easynews-plus:fixture-signature');
  expect(video.released).toBe('2023-11-14T22:13:20.000Z');
  expect(video.thumbnail).toBe(
    `https://th.easynews.com/thumbnails-aaa/pr-${'a'.repeat(41)}.jpg`
  );
  expect(video.streams[0].url).toContain(
    `/dl/auto/auto/${'a'.repeat(41)}1234.mkv/Coachella Concert.mkv`
  );
});

it('caps catalog queries at 500 videos with HTTP URLs and thumbnails', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: URL) => {
      const page = Number(url.searchParams.get('pno'));
      return Response.json({
        numPages: 100,
        downURL: 'https://members.easynews.com/dl',
        dlFarm: 'auto',
        dlPort: 'auto',
        data: Array.from({ length: 100 }, (_, i) => {
          const id = (page - 1) * 100 + i;
          return {
            '0': id.toString(16).padStart(41, '0'),
            '2': '.mkv',
            '11': '.mkv',
            '5': '2025-01-01T00:00:00Z',
            '10': `Concert ${id}`,
            sig: `fixture-${id}`,
            rawSize: 1000,
          };
        }),
      });
    })
  );
  const result = await addonInterface.get(
    'meta',
    'tv',
    'easynews-plus:Concert',
    {},
    { username: 'fixture-user', password: 'fixture-password' }
  );
  expect(result.meta.videos).toHaveLength(500);
  expect(result.meta.videos[199].title).toBe('Concert 199');
  expect(result.meta.videos[199].streams[0].url).toContain(
    'members.easynews.com/dl/'
  );
  expect(result.meta.videos[199].thumbnail).toContain(
    'https://th.easynews.com/thumbnails-'
  );
});
