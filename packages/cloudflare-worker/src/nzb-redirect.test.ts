import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchNzbWithRedirects } from './playback.js';
afterEach(() => vi.unstubAllGlobals());
describe('Easynews NZB redirects', () => {
  const form = new URLSearchParams({ autoNZB: '1', '0': 'file-token' });
  const signal = () => AbortSignal.timeout(1000);
  it('follows a same-host 302 as GET without resending the form body', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { Location: '/download/result.nzb' },
        })
      )
      .mockResolvedValueOnce(new Response('<nzb/>'));
    vi.stubGlobal('fetch', fetcher);
    expect((await fetchNzbWithRedirects(form, 'private', signal)).status).toBe(
      200
    );
    expect(fetcher.mock.calls[1][1].method).toBe('GET');
    expect(fetcher.mock.calls[1][1].body).toBeUndefined();
    expect(fetcher.mock.calls[1][1].headers.Authorization).toBe(
      'Basic private'
    );
  });
  it('does not forward credentials to another Easynews host', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 303,
          headers: { Location: 'https://download.easynews.com/file.nzb' },
        })
      )
      .mockResolvedValueOnce(new Response('<nzb/>'));
    vi.stubGlobal('fetch', fetcher);
    await fetchNzbWithRedirects(form, 'private', signal);
    expect(fetcher.mock.calls[1][1].headers.Authorization).toBeUndefined();
  });
  it.each(['https://other.example/file', 'http://members.easynews.com/file'])(
    'rejects unsafe target %s',
    async (target) => {
      const fetcher = vi
        .fn()
        .mockResolvedValue(
          new Response(null, { status: 302, headers: { Location: target } })
        );
      vi.stubGlobal('fetch', fetcher);
      await expect(
        fetchNzbWithRedirects(form, 'private', signal)
      ).rejects.toThrow('NZB handoff failed');
      expect(fetcher).toHaveBeenCalledTimes(1);
    }
  );
});
