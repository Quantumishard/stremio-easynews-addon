import { afterEach, expect, it, vi } from 'vitest';
import { addonInterface } from './addon.js';

afterEach(() => vi.unstubAllGlobals());

it('returns matching catalog videos beyond the first 100 with HTTP URLs and thumbnails', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: URL) => {
      const page = Number(url.searchParams.get('pno'));
      return Response.json({
        numPages: 2,
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
  expect(result.meta.videos).toHaveLength(200);
  expect(result.meta.videos[199].title).toBe('Concert 199');
  expect(result.meta.videos[199].streams[0].url).toContain(
    'members.easynews.com/dl/'
  );
  expect(result.meta.videos[199].thumbnail).toContain(
    'https://th.easynews.com/thumbnails-'
  );
});

