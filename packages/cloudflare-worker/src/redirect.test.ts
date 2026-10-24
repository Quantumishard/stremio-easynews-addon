import { afterEach, describe, expect, it, vi } from 'vitest';
import { loginWithRedirects } from './playback.js';
afterEach(() => vi.unstubAllGlobals());
describe('AIOStreams login redirects', () => {
  const env = {
    AIOSTREAMS_USERNAME: 'operator',
    AIOSTREAMS_PASSWORD: 'private',
  };
  const signal = () => AbortSignal.timeout(1000);
  it('preserves POST only for canonical login redirects on the configured origin', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 308,
          headers: { Location: '/api/v1/auth/login/' },
        })
      )
      .mockResolvedValueOnce(new Response('{}'));
    vi.stubGlobal('fetch', fetcher);
    expect(
      (await loginWithRedirects(new URL('https://aio.example'), env, signal))
        .status
    ).toBe(200);
    expect(fetcher.mock.calls[1][0].href).toBe(
      'https://aio.example/api/v1/auth/login/'
    );
    expect(fetcher.mock.calls[1][1].method).toBe('POST');
    expect(JSON.parse(fetcher.mock.calls[1][1].body).password).toBe('private');
  });
  it.each(['https://other.example/login', '/login', '/cdn-cgi/access/login'])(
    'does not forward credentials to %s',
    async (destination) => {
      const fetcher = vi.fn().mockResolvedValue(
        new Response(null, {
          status: 302,
          headers: { Location: destination },
        })
      );
      vi.stubGlobal('fetch', fetcher);
      await expect(
        loginWithRedirects(new URL('https://aio.example'), env, signal)
      ).rejects.toThrow('NZB handoff failed');
      expect(fetcher).toHaveBeenCalledTimes(1);
    }
  );
});
