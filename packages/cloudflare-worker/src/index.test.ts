import { describe, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { Hono } from 'hono';
vi.stubGlobal('crypto', webcrypto);
vi.mock('@easynews/addon', () => ({ addonInterface: {}, landingHTML: '' }));
vi.mock('./router.js', () => ({
  getRouter: () => {
    const routes = new Hono();
    routes.get('/meta/tv/demo.json', (c) =>
      c.json({
        cacheMaxAge: 604800,
        meta: {
          videos: [
            {
              id: 'easynews-plus:signature',
              thumbnail: 'https://members.easynews.com/preview/example.jpg',
              streams: [
                {
                  name: 'Easynews+',
                  url: `https://user:password@members.easynews.com/dl/auto/auto/${'a'.repeat(40)}.mkv/Movie.mkv`,
                },
              ],
            },
          ],
        },
      })
    );
    return routes;
  },
}));
import app from './index.js';

describe('Worker responses', () => {
  const env = {
    AIOSTREAMS_URL: 'https://aio.example',
    AIOSTREAMS_USERNAME: 'user',
    AIOSTREAMS_PASSWORD: 'secret',
    PLAYBACK_TOKEN_SECRET: 'secret-value-with-at-least-thirty-two-characters',
  };
  it('adds NZB alongside HTTP and an authenticated thumbnail in actual Worker middleware', async () => {
    const response = await app.request(
      'https://worker.example/meta/tv/demo.json',
      {},
      env
    );
    expect(response.status).toBe(200);
    const value: any = await response.json();
    expect(value.meta.videos[0].streams).toHaveLength(2);
    expect(value.meta.videos[0].streams[0].url).toContain(
      '@members.easynews.com'
    );
    expect(value.meta.videos[0].streams[1].url).toContain('/play/');
    expect(value.meta.videos[0].thumbnail).toContain(
      'https://worker.example/thumbnail/'
    );
    expect(value.cacheMaxAge).toBe(60);
  });
  it('keeps the original response when settings are absent and reports missing settings', async () => {
    const response = await app.request(
      'https://worker.example/meta/tv/demo.json',
      {},
      {}
    );
    const value: any = await response.json();
    expect(value.meta.videos[0].streams).toHaveLength(1);
    expect(value.meta.videos[0].thumbnail).toBe(
      'https://members.easynews.com/preview/example.jpg'
    );
    const health: any = await (
      await app.request('https://worker.example/health', {}, {})
    ).json();
    expect(health.nzbEnabled).toBe(false);
    expect(JSON.stringify(health)).not.toContain('password@');
  });
});
