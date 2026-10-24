import { afterEach, describe, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { addNzbOptions, playback, seal, thumbnail } from './playback.js';

vi.stubGlobal('crypto', webcrypto);
const env = {
  AIOSTREAMS_URL: 'https://aio.example',
  AIOSTREAMS_USERNAME: 'operator',
  AIOSTREAMS_PASSWORD: 'private-password',
  PLAYBACK_TOKEN_SECRET: 'a-test-secret-with-at-least-32-characters',
};
const hash = 'a'.repeat(40);
const selection = {
  hash,
  filename: 'Movie.2025',
  ext: 'mkv',
  username: 'en-user',
  password: 'en-password',
  expires: Date.now() + 100000,
};
afterEach(() => {
  vi.unstubAllGlobals();
  vi.stubGlobal('crypto', webcrypto);
});

describe('optional NZB results', () => {
  it('authenticates image requests while rejecting non-Easynews destinations', async () => {
    const fetcher = vi.fn(async (_url: any, init: any) => {
      expect(init.headers.Authorization).toMatch(/^Basic /);
      expect(init.redirect).toBe('manual');
      return new Response(new Uint8Array([255, 216, 255]), {
        headers: { 'Content-Type': 'image/jpeg' },
      });
    });
    vi.stubGlobal('fetch', fetcher);
    const token = await seal(
      {
        ...selection,
        thumbnail: 'https://members.easynews.com/preview/test.jpg',
      },
      env.PLAYBACK_TOKEN_SECRET
    );
    const response = await thumbnail(
      new Request('https://worker/thumbnail/x'),
      token,
      env
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('image/jpeg');
    const bad = await seal(
      { ...selection, thumbnail: 'https://evil.example/image.jpg' },
      env.PLAYBACK_TOKEN_SECRET
    );
    expect(
      (await thumbnail(new Request('https://worker/thumbnail/x'), bad, env))
        .status
    ).toBe(400);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('preserves HTTP and adds an encrypted option in nested catalog metadata', async () => {
    const http = {
      name: 'Easynews+',
      url: `https://en-user:en-password@members.easynews.com/dl/auto/auto/${hash}.mkv/Movie.2025.mkv`,
      behaviorHints: { videoSize: 123 },
    };
    const result = { meta: { videos: [{ streams: [http] }] } };
    await addNzbOptions(result, 'https://worker.example', env);
    const streams = result.meta.videos[0].streams;
    expect(streams).toHaveLength(2);
    expect(streams[0]).toBe(http);
    expect(streams[1].name).toContain('NZB');
    expect(streams[1].url).toMatch(/^https:\/\/worker.example\/play\//);
    expect(streams[1].url).not.toContain('en-password');
  });
  it('leaves results unchanged when secrets are absent or the host is unrelated', async () => {
    const result = {
      streams: [{ url: 'https://user:pass@evil.example/file.mkv' }],
    };
    await addNzbOptions(result, 'https://worker.example', env);
    expect(result.streams).toHaveLength(1);
    await addNzbOptions(result, 'https://worker.example', {});
    expect(result.streams).toHaveLength(1);
  });
});

describe('playback handoff', () => {
  it('rejects expired, tampered and HEAD links without upstream work', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const expired = await seal(
      { ...selection, expires: 1 },
      env.PLAYBACK_TOKEN_SECRET
    );
    expect(
      (await playback(new Request('https://worker/play/x'), expired, env))
        .status
    ).toBe(400);
    expect(
      (await playback(new Request('https://worker/play/x'), 'bad', env)).status
    ).toBe(400);
    expect(
      (
        await playback(
          new Request('https://worker/play/x', { method: 'HEAD' }),
          'bad',
          env
        )
      ).status
    ).toBe(405);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('authenticates, imports NZB, selects the file and redirects without fetching video bytes', async () => {
    const calls: string[] = [];
    const fetcher = vi.fn(async (url: any, init: any) => {
      const path = new URL(String(url)).pathname;
      calls.push(path);
      if (path.endsWith('/auth/login')) {
        expect(JSON.parse(init.body).password).toBe(env.AIOSTREAMS_PASSWORD);
        return new Response('{}', {
          headers: {
            'Set-Cookie': 'aiostreams.session=private; Path=/; HttpOnly',
          },
        });
      }
      if (path.endsWith('/dl-nzb')) {
        expect(new URLSearchParams(init.body).get('0')).toContain(hash);
        return new Response(
          '<nzb><file><segments><segment bytes="1">id</segment></segments></file></nzb>'
        );
      }
      expect(new Headers(init.headers).get('Cookie')).toBe(
        'aiostreams.session=private'
      );
      let data: any;
      if (path.endsWith('/upload')) data = { nzbHash: hash, status: 'queued' };
      else if (path.endsWith('/files'))
        data = {
          files: [{ index: 7, name: 'Movie 2025.mkv', streamable: true }],
        };
      else if (path.endsWith('/play/7'))
        data = { url: '/api/v1/usenet/stream/opaque' };
      else throw new Error('Unexpected request');
      return Response.json({ success: true, data });
    });
    vi.stubGlobal('fetch', fetcher);
    const token = await seal(selection, env.PLAYBACK_TOKEN_SECRET);
    const result = await playback(
      new Request('https://worker/play/x'),
      token,
      env
    );
    expect(result.status).toBe(307);
    expect(result.headers.get('Location')).toBe(
      'https://aio.example/api/v1/usenet/stream/opaque'
    );
    expect(result.headers.get('Cache-Control')).toBe('no-store');
    expect(calls).toHaveLength(5);
    expect(calls.some((p) => p.includes('/usenet/stream/'))).toBe(false);
    await playback(new Request('https://worker/play/x'), token, env);
    expect(fetcher).toHaveBeenCalledTimes(5);
  });
  it('does not expose upstream credentials or silently redirect to HTTP after failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('private-password', { status: 403 }))
    );
    const token = await seal(
      { ...selection, hash: 'b'.repeat(40) },
      env.PLAYBACK_TOKEN_SECRET
    );
    const result = await playback(
      new Request('https://worker/play/x'),
      token,
      env
    );
    expect(result.status).toBe(502);
    expect(result.headers.has('Location')).toBe(false);
    expect(await result.text()).not.toContain('private-password');
  });
});

it('keeps public Easynews thumbnails direct while preserving both playback options', async () => {
  const image =
    'https://th.easynews.com/thumbnails-aaa/pr-' + 'a'.repeat(41) + '.jpg';
  const result = {
    thumbnail: image,
    streams: [
      {
        url: `https://en-user:en-password@members.easynews.com/dl/auto/auto/${hash}.mkv/Movie.2025.mkv`,
      },
    ],
  };
  await addNzbOptions(result, 'https://worker.example', env);
  expect(result.thumbnail).toBe(image);
  expect(result.streams).toHaveLength(2);
});
