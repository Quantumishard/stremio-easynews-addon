import { Hono } from 'hono';
import { addonInterface, landingHTML } from '@easynews/addon';
import { getRouter } from './router.js';
import {
  addNzbOptions,
  enabled,
  playback,
  thumbnail,
  type PlaybackEnv,
} from './playback.js';

const addonRouter = getRouter(addonInterface, { landingHTML });
const app = new Hono<{ Bindings: PlaybackEnv }>();

app.get('/health', (c) =>
  c.json(
    {
      build: 'nzb-playback-4-v3-search',
      search: { apiVersion: 3, maxCandidates: 500, deadlineSeconds: 8 },
      nzbEnabled: enabled(c.env),
      settings: {
        url: !!c.env.AIOSTREAMS_URL,
        username: !!c.env.AIOSTREAMS_USERNAME,
        password: !!c.env.AIOSTREAMS_PASSWORD,
        tokenSecret: !!c.env.PLAYBACK_TOKEN_SECRET,
        tokenSecretLongEnough: (c.env.PLAYBACK_TOKEN_SECRET?.length || 0) >= 32,
      },
    },
    200,
    { 'Cache-Control': 'no-store' }
  )
);

app.all('/play/:token', (c) =>
  playback(c.req.raw, c.req.param('token'), c.env)
);
app.all('/thumbnail/:token', (c) =>
  thumbnail(c.req.raw, c.req.param('token'), c.env)
);
app.use('*', async (c, next) => {
  const start = performance.now();
  await next();
  if (
    !enabled(c.env) ||
    !c.res.ok ||
    !c.req.path.endsWith('.json') ||
    !/\/(meta|stream)\//.test(c.req.path) ||
    !c.res.headers.get('Content-Type')?.includes('application/json')
  )
    return;
  const value = await c.res.json();
  const addonMs = Math.round(performance.now() - start);
  await addNzbOptions(value, new URL(c.req.url).origin, c.env);
  const videos = (value as { meta?: { videos?: unknown[] } })?.meta?.videos;
  console.info(
    'SEARCH_RESPONSE',
    JSON.stringify({
      kind: /\/meta\//.test(c.req.path) ? 'meta' : 'stream',
      videos: Array.isArray(videos) ? videos.length : undefined,
      addonMs,
      totalMs: Math.round(performance.now() - start),
    })
  );
  const headers = new Headers(c.res.headers);
  // Make option and thumbnail fixes visible to clients after a refresh.
  headers.set('Cache-Control', 'private, max-age=60');
  for (const key of ['cacheMaxAge', 'staleRevalidate', 'staleError']) {
    if (value && typeof value === 'object' && key in value)
      (value as any)[key] = 60;
  }
  headers.delete('Content-Length');
  headers.delete('ETag');
  headers.delete('Content-Encoding');
  c.res = new Response(JSON.stringify(value), {
    status: c.res.status,
    headers,
  });
});
app.route('/', addonRouter);
export default app;
