import { afterEach, describe, expect, it, vi } from 'vitest';
import { aioRequestWithRedirects } from './playback.js';
afterEach(() => vi.unstubAllGlobals());
describe('AIOStreams API redirects', () => {
  const signal = () => AbortSignal.timeout(1000);
  it('preserves multipart upload and session on a canonical redirect', async () => {
    const form = new FormData();
    form.set('file', new Blob(['<nzb/>']), 'file.nzb');
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 308,
          headers: { Location: '/api/v1/dashboard/usenet/library/upload/' },
        })
      )
      .mockResolvedValueOnce(Response.json({ success: true }));
    vi.stubGlobal('fetch', fetcher);
    const init = {
      method: 'POST',
      body: form,
      headers: { Cookie: 'aiostreams.session=private' },
    };
    expect(
      (
        await aioRequestWithRedirects(
          new URL('https://aio.example'),
          'dashboard/usenet/library/upload',
          init,
          signal,
          'AIOStreams upload'
        )
      ).status
    ).toBe(200);
    expect(fetcher.mock.calls[1][1].body).toBe(form);
    expect(fetcher.mock.calls[1][1].method).toBe('POST');
    expect(fetcher.mock.calls[1][1].headers.Cookie).toContain('private');
  });
  it('follows canonical GET redirects for file inspection', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 301,
          headers: { Location: '/api/v1/dashboard/usenet/library/abc/files/' },
        })
      )
      .mockResolvedValueOnce(Response.json({ success: true }));
    vi.stubGlobal('fetch', fetcher);
    expect(
      (
        await aioRequestWithRedirects(
          new URL('https://aio.example'),
          'dashboard/usenet/library/abc/files',
          {},
          signal,
          'AIOStreams inspection'
        )
      ).status
    ).toBe(200);
  });
  it.each(['https://other.example/upload', '/login'])(
    'does not send the upload or session to %s',
    async (destination) => {
      const fetcher = vi.fn().mockResolvedValue(
        new Response(null, {
          status: 302,
          headers: { Location: destination },
        })
      );
      vi.stubGlobal('fetch', fetcher);
      await expect(
        aioRequestWithRedirects(
          new URL('https://aio.example'),
          'dashboard/usenet/library/upload',
          { method: 'POST', body: 'private' },
          signal,
          'AIOStreams upload'
        )
      ).rejects.toThrow('NZB handoff failed');
      expect(fetcher).toHaveBeenCalledTimes(1);
    }
  );
});
