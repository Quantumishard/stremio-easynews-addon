export type PlaybackEnv = {
  AIOSTREAMS_URL?: string;
  AIOSTREAMS_USERNAME?: string;
  AIOSTREAMS_PASSWORD?: string;
  PLAYBACK_TOKEN_SECRET?: string;
};

type Selection = {
  hash: string;
  filename: string;
  ext: string;
  username: string;
  password: string;
  sig?: string;
  thumbnail?: string;
  expires: number;
};
const TTL = 10 * 24 * 60 * 60 * 1000;
const encoder = new TextEncoder();
const pending = new Map<string, Promise<string>>();
const ready = new Map<string, { url: string; expires: number }>();

export function enabled(env: PlaybackEnv): boolean {
  return !!(
    env.AIOSTREAMS_URL &&
    env.AIOSTREAMS_USERNAME &&
    env.AIOSTREAMS_PASSWORD &&
    env.PLAYBACK_TOKEN_SECRET &&
    env.PLAYBACK_TOKEN_SECRET.length >= 32
  );
}

function encode(bytes: Uint8Array): string {
  let text = '';
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decode(text: string): Uint8Array {
  return Uint8Array.from(
    atob(text.replace(/-/g, '+').replace(/_/g, '/')),
    (c) => c.charCodeAt(0)
  );
}

async function key(secret: string) {
  return crypto.subtle.importKey(
    'raw',
    await crypto.subtle.digest('SHA-256', encoder.encode(secret)),
    'AES-GCM',
    false,
    ['encrypt', 'decrypt']
  );
}

export async function seal(
  selection: Selection,
  secret: string
): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      await key(secret),
      encoder.encode(JSON.stringify(selection))
    )
  );
  const bytes = new Uint8Array(iv.length + ciphertext.length);
  bytes.set(iv);
  bytes.set(ciphertext, iv.length);
  return encode(bytes);
}

async function unseal(token: string, secret: string): Promise<Selection> {
  if (token.length > 16000) throw new Error('Invalid playback link');
  const bytes = decode(token);
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: bytes.slice(0, 12) },
    await key(secret),
    bytes.slice(12)
  );
  const s = JSON.parse(new TextDecoder().decode(plain));
  if (
    typeof s.hash !== 'string' ||
    !/^[a-f0-9]{32,64}$/i.test(s.hash) ||
    !['filename', 'ext', 'username', 'password'].every(
      (k) => typeof s[k] === 'string'
    ) ||
    !Number.isFinite(s.expires) ||
    s.expires <= Date.now()
  )
    throw new Error('Expired or invalid playback link');
  return s;
}

function selectionFromUrl(raw: string): Selection | undefined {
  try {
    const url = new URL(raw);
    if (
      !['https:', 'http:'].includes(url.protocol) ||
      !/(^|\.)easynews\.com$/i.test(url.hostname) ||
      !url.username
    )
      return;
    const parts = url.pathname.split('/');
    const file = decodeURIComponent(parts[parts.length - 1]);
    const hashed = decodeURIComponent(parts[parts.length - 2]);
    const match = /^([a-f0-9]{32,64})\.([a-z0-9]+)$/i.exec(hashed);
    if (!match || !file.toLowerCase().endsWith('.' + match[2].toLowerCase()))
      return;
    return {
      hash: match[1],
      filename: file.slice(0, -(match[2].length + 1)),
      ext: match[2],
      username: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      expires: Date.now() + TTL,
    };
  } catch {
    return;
  }
}

/** Only duplicate actual stream objects; catalog metadata and HTTP URLs stay intact. */
export async function addNzbOptions(
  value: unknown,
  origin: string,
  env: PlaybackEnv,
  sig?: string
): Promise<void> {
  if (!enabled(env) || !value || typeof value !== 'object') return;
  const obj = value as Record<string, unknown>;
  // Thumbnails live on authenticated Easynews hosts. Players cannot attach
  // the addon account's Authorization header to those image requests.
  if (typeof obj.thumbnail === 'string' && Array.isArray(obj.streams)) {
    const source = obj.streams.find(
      (s: any) => typeof s?.url === 'string' && selectionFromUrl(s.url)
    );
    const selection = source && selectionFromUrl(source.url);
    if (selection) {
      try {
        const image = new URL(obj.thumbnail, 'https://members.easynews.com');
        if (
          image.hostname.toLowerCase() !== 'th.easynews.com' &&
          /(^|\.)easynews\.com$/i.test(image.hostname) &&
          !image.username &&
          !image.password
        ) {
          image.protocol = 'https:';
          selection.thumbnail = image.href;
          obj.thumbnail = `${origin}/thumbnail/${await seal(selection, env.PLAYBACK_TOKEN_SECRET!)}`;
        }
      } catch {
        /* Keep unrelated or invalid thumbnail values unchanged. */
      }
    }
  }
  if (typeof obj.id === 'string' && obj.id.startsWith('easynews-plus:'))
    sig = obj.id.slice('easynews-plus:'.length);
  for (const [field, child] of Object.entries(obj)) {
    if (field === 'streams' && Array.isArray(child)) {
      const output: unknown[] = [];
      for (const stream of child) {
        output.push(stream);
        if (!stream || typeof stream.url !== 'string') continue;
        const selection = selectionFromUrl(stream.url);
        if (!selection) continue;
        if (sig) selection.sig = sig;
        output.push({
          ...stream,
          name: `${stream.name || 'Easynews+'} NZB`,
          url: `${origin}/play/${await seal(selection, env.PLAYBACK_TOKEN_SECRET!)}`,
          behaviorHints: {
            ...stream.behaviorHints,
            bingeGroup: `${stream.behaviorHints?.bingeGroup || 'Easynews+'}-nzb`,
          },
        });
      }
      obj[field] = output;
    } else if (Array.isArray(child)) {
      for (const item of child) await addNzbOptions(item, origin, env, sig);
    } else await addNzbOptions(child, origin, env, sig);
  }
}

export async function thumbnail(
  request: Request,
  token: string,
  env: PlaybackEnv
): Promise<Response> {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'private, max-age=3600',
    'Referrer-Policy': 'no-referrer',
  };
  if (request.method !== 'GET')
    return new Response(null, {
      status: 405,
      headers: { ...headers, Allow: 'GET' },
    });
  if (!enabled(env)) return new Response(null, { status: 503 });
  try {
    const selection = await unseal(token, env.PLAYBACK_TOKEN_SECRET!);
    if (!selection.thumbnail) return new Response(null, { status: 400 });
    const url = new URL(selection.thumbnail);
    if (
      url.protocol !== 'https:' ||
      !/(^|\.)easynews\.com$/i.test(url.hostname) ||
      url.username ||
      url.password
    )
      return new Response(null, { status: 400 });
    const auth = btoa(
      String.fromCharCode(
        ...encoder.encode(`${selection.username}:${selection.password}`)
      )
    );
    const image = await fetch(url, {
      headers: { Authorization: `Basic ${auth}`, Accept: 'image/*' },
      redirect: 'manual',
      signal: AbortSignal.timeout(15000),
    });
    const type = image.headers.get('Content-Type') || '';
    if (!image.ok || !type.startsWith('image/')) {
      await image.body?.cancel();
      return new Response(null, {
        status: 502,
        headers: { 'Cache-Control': 'no-store' },
      });
    }
    return new Response(image.body, {
      headers: { ...headers, 'Content-Type': type },
    });
  } catch {
    return new Response(null, {
      status: 502,
      headers: { 'Cache-Control': 'no-store' },
    });
  }
}

function baseUrl(env: PlaybackEnv): URL {
  const base = new URL(env.AIOSTREAMS_URL!);
  if (
    base.protocol !== 'https:' ||
    base.username ||
    base.password ||
    base.search ||
    base.hash ||
    base.pathname !== '/'
  )
    throw new Error('AIOStreams must use an HTTPS base URL');
  return base;
}

class HandoffError extends Error {
  constructor(
    readonly stage: string,
    readonly status?: number,
    readonly reason?: string,
    readonly backendHost?: string,
    readonly redirectHost?: string
  ) {
    super('NZB handoff failed');
  }
}

export async function loginWithRedirects(
  base: URL,
  env: PlaybackEnv,
  signal: () => AbortSignal
): Promise<Response> {
  let current = new URL('/api/v1/auth/login', base);
  for (let hop = 0; hop < 4; hop++) {
    const response = await fetch(current, {
      method: 'POST',
      redirect: 'manual',
      signal: signal(),
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        username: env.AIOSTREAMS_USERNAME,
        password: env.AIOSTREAMS_PASSWORD,
      }),
    });
    if (response.status < 300 || response.status >= 400) return response;
    const location = response.headers.get('Location');
    await response.body?.cancel();
    let destination: URL;
    try {
      destination = new URL(location || '', current);
    } catch {
      throw new HandoffError(
        'AIOStreams login',
        response.status,
        'invalid-redirect:0s',
        base.hostname
      );
    }
    const canonical =
      location &&
      destination.origin === base.origin &&
      !destination.username &&
      !destination.password &&
      !destination.search &&
      !destination.hash &&
      /^\/api\/v1\/auth\/login\/?$/.test(destination.pathname) &&
      [301, 302, 307, 308].includes(response.status);
    if (!canonical)
      throw new HandoffError(
        'AIOStreams login',
        response.status,
        destination.origin !== base.origin
          ? 'cross-host-redirect:0s'
          : 'browser-login-redirect:0s',
        base.hostname,
        destination.hostname
      );
    current = destination;
  }
  throw new HandoffError(
    'AIOStreams login',
    undefined,
    'redirect-loop:0s',
    base.hostname
  );
}

export async function aioRequestWithRedirects(
  base: URL,
  path: string,
  init: RequestInit,
  signal: () => AbortSignal,
  stage: string
): Promise<Response> {
  let current = new URL(`/api/v1/${path}`, base);
  const originalPath = current.pathname.replace(/\/$/, '');
  for (let hop = 0; hop < 4; hop++) {
    const response = await fetch(current, {
      ...init,
      redirect: 'manual',
      signal: signal(),
    });
    if (response.status < 300 || response.status >= 400) return response;
    const location = response.headers.get('Location');
    await response.body?.cancel();
    if (!location)
      throw new HandoffError(
        stage,
        response.status,
        'missing-redirect:0s',
        base.hostname
      );
    const next = new URL(location, current);
    const canonical =
      next.origin === base.origin &&
      !next.username &&
      !next.password &&
      !next.search &&
      !next.hash &&
      next.pathname.replace(/\/$/, '') === originalPath &&
      [301, 302, 307, 308].includes(response.status);
    if (!canonical)
      throw new HandoffError(
        stage,
        response.status,
        next.origin === base.origin
          ? 'noncanonical-redirect:0s'
          : 'cross-host-redirect:0s',
        base.hostname,
        next.hostname
      );
    current = next;
  }
  throw new HandoffError(stage, undefined, 'redirect-loop:0s', base.hostname);
}

export async function fetchNzbWithRedirects(
  form: URLSearchParams,
  auth: string,
  signal: () => AbortSignal
): Promise<Response> {
  const initial = new URL('https://members.easynews.com/2.0/api/dl-nzb');
  let current = initial;
  let method = 'POST';
  for (let hop = 0; hop < 5; hop++) {
    const headers: Record<string, string> = {
      Accept: 'application/x-nzb, */*',
    };
    if (current.origin === initial.origin)
      headers.Authorization = `Basic ${auth}`;
    if (method === 'POST')
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
    const response = await fetch(current, {
      method,
      headers,
      body: method === 'POST' ? form.toString() : undefined,
      redirect: 'manual',
      signal: signal(),
    });
    if (response.status < 300 || response.status >= 400) return response;
    const location = response.headers.get('Location');
    await response.body?.cancel();
    if (!location)
      throw new HandoffError(
        'Easynews NZB retrieval',
        response.status,
        'missing-redirect:0s'
      );
    const next = new URL(location, current);
    if (
      next.protocol !== 'https:' ||
      !/(^|\.)easynews\.com$/i.test(next.hostname) ||
      next.username ||
      next.password ||
      ![301, 302, 303, 307, 308].includes(response.status)
    ) {
      throw new HandoffError(
        'Easynews NZB retrieval',
        response.status,
        'unsafe-redirect:0s'
      );
    }
    if (
      response.status === 303 ||
      ([301, 302].includes(response.status) && method === 'POST')
    )
      method = 'GET';
    if (method === 'POST' && next.origin !== initial.origin)
      throw new HandoffError(
        'Easynews NZB retrieval',
        response.status,
        'cross-host-post:0s'
      );
    current = next;
  }
  throw new HandoffError(
    'Easynews NZB retrieval',
    undefined,
    'redirect-loop:0s'
  );
}

async function resolve(
  selection: Selection,
  env: PlaybackEnv
): Promise<string> {
  const started = Date.now();
  let stage = 'configuration';
  try {
    const base = baseUrl(env);
    const deadline = Date.now() + 45000;
    const signal = () =>
      AbortSignal.timeout(Math.max(1, Math.min(20000, deadline - Date.now())));
    const api = async (
      path: string,
      init: RequestInit = {},
      cookie?: string
    ): Promise<any> => {
      stage = path.endsWith('/upload')
        ? 'AIOStreams upload'
        : path.endsWith('/files')
          ? 'AIOStreams inspection'
          : 'AIOStreams playback URL';
      const headers = new Headers(init.headers);
      headers.set('Accept', 'application/json');
      if (cookie) headers.set('Cookie', cookie);
      const response = await aioRequestWithRedirects(
        base,
        path,
        { ...init, headers },
        signal,
        stage
      );
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(`AIOStreams request failed (${response.status})`);
      }
      const result: any = await response.json();
      if (!result.success) throw new Error('AIOStreams rejected the request');
      return result.data;
    };
    stage = 'AIOStreams login';
    const login = await loginWithRedirects(base, env, signal);
    if (!login.ok) {
      await login.body?.cancel();
      throw new Error(`AIOStreams login failed (${login.status})`);
    }
    stage = 'AIOStreams session cookie';
    const cookies = login.headers.get('Set-Cookie') || '';
    const session = /(?:^|,\s*)(aiostreams\.session=[^;,]+)/.exec(cookies)?.[1];
    await login.body?.cancel();
    if (!session) throw new Error('AIOStreams did not issue a session');

    const form = new URLSearchParams({ autoNZB: '1' });
    // Easynews accepts a file hash and encoded filename/extension without a sig.
    const b64 = (text: string) =>
      btoa(String.fromCharCode(...encoder.encode(text))).replace(/=+$/, '');
    form.set(
      selection.sig ? `0&sig=${selection.sig}` : '0',
      `${selection.hash}|${b64(selection.filename)}:${b64(selection.ext)}`
    );
    const auth = btoa(
      String.fromCharCode(
        ...encoder.encode(`${selection.username}:${selection.password}`)
      )
    );
    stage = 'Easynews NZB retrieval';
    const nzbResponse = await fetchNzbWithRedirects(form, auth, signal);
    if (!nzbResponse.ok) {
      await nzbResponse.body?.cancel();
      throw new Error(`Easynews NZB retrieval failed (${nzbResponse.status})`);
    }
    stage = 'NZB download and validation';
    // Bound memory, including when Content-Length is absent or inaccurate.
    const reader = nzbResponse.body!.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > 16 * 1024 * 1024) {
        await reader.cancel();
        throw new Error('NZB exceeds 16 MiB limit');
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    if (!new TextDecoder().decode(bytes).includes('<segment'))
      throw new Error('Easynews returned an empty or invalid NZB');
    const upload = new FormData();
    upload.set(
      'file',
      new Blob([bytes], { type: 'application/x-nzb' }),
      'easynews.nzb'
    );
    upload.set('name', `${selection.filename}.${selection.ext}`);
    const entry = await api(
      'dashboard/usenet/library/upload',
      { method: 'POST', body: upload },
      session
    );
    const hash = entry.nzbHash;
    if (typeof hash !== 'string' || !/^[a-f0-9]+$/i.test(hash))
      throw new Error('Invalid library response');
    const normalize = (s: string) => s.toLowerCase().replace(/[\s._-]+/g, ' ');
    while (Date.now() < deadline) {
      const listing = await api(
        `dashboard/usenet/library/${hash}/files`,
        {},
        session
      );
      const files = (listing.files || []).filter(
        (f: any) => f.streamable && Number.isInteger(f.index)
      );
      const wanted = normalize(`${selection.filename}.${selection.ext}`);
      const matching = files.filter(
        (f: any) => typeof f.name === 'string' && normalize(f.name) === wanted
      );
      const file =
        matching.length === 1
          ? matching[0]
          : files.length === 1
            ? files[0]
            : undefined;
      if (file) {
        const result = await api(
          `dashboard/usenet/library/${hash}/play/${file.index}`,
          {},
          session
        );
        const target = new URL(result.url, base);
        if (
          target.origin !== base.origin ||
          !target.pathname.startsWith('/api/v1/usenet/stream/')
        )
          throw new Error('Unexpected playback destination');
        return target.href;
      }
      if (files.length > 1)
        throw new Error('Multiple videos found; no unique filename match');
      if (entry.status === 'failed')
        throw new Error('AIOStreams could not stream this NZB');
      await new Promise((r) => setTimeout(r, 3000));
    }
    throw new Error(
      'NZB inspection timed out; retry playback or use the HTTP option'
    );
  } catch (error) {
    if (error instanceof HandoffError) throw error;
    const status =
      error instanceof Error
        ? /failed \((\d{3})\)/.exec(error.message)?.[1]
        : undefined;
    const message = error instanceof Error ? error.message : '';
    const reason = /redirect/i.test(message)
      ? 'redirect'
      : /timeout|aborted/i.test(message)
        ? 'timeout-or-abort'
        : /ssl|tls|certificate/i.test(message)
          ? 'tls'
          : /dns|resolve.*host/i.test(message)
            ? 'dns'
            : /different request|on behalf/i.test(message)
              ? 'request-isolation'
              : /fetch failed|network|connection/i.test(message)
                ? 'connection'
                : error instanceof Error && error.name === 'TypeError'
                  ? 'type-error'
                  : 'other';
    throw new HandoffError(
      stage,
      status ? Number(status) : undefined,
      reason + ':' + Math.round((Date.now() - started) / 1000) + 's'
    );
  }
}

export async function playback(
  request: Request,
  token: string,
  env: PlaybackEnv
): Promise<Response> {
  const headers = {
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
    'Access-Control-Allow-Origin': '*',
  };
  if (request.method === 'OPTIONS')
    return new Response(null, {
      status: 204,
      headers: { ...headers, 'Access-Control-Allow-Methods': 'GET, OPTIONS' },
    });
  if (request.method !== 'GET')
    return new Response('Use GET to start playback', {
      status: 405,
      headers: { ...headers, Allow: 'GET, OPTIONS' },
    });
  if (!enabled(env))
    return new Response('NZB playback is not configured', {
      status: 503,
      headers,
    });
  let selection: Selection;
  try {
    selection = await unseal(token, env.PLAYBACK_TOKEN_SECRET!);
  } catch {
    return new Response(
      'Expired or invalid playback link; refresh search results',
      { status: 400, headers }
    );
  }
  // The cache key includes credentials and backend identity but never exposes them.
  const id = encode(
    new Uint8Array(
      await crypto.subtle.digest(
        'SHA-256',
        encoder.encode(
          JSON.stringify({
            ...selection,
            expires: 0,
            backend: env.AIOSTREAMS_URL,
            owner: env.AIOSTREAMS_USERNAME,
            credential: env.AIOSTREAMS_PASSWORD,
          })
        )
      )
    )
  );
  try {
    const hit = ready.get(id);
    let url = hit && hit.expires > Date.now() ? hit.url : undefined;
    if (!url) {
      let promise = pending.get(id);
      if (!promise) {
        promise = resolve(selection, env);
        pending.set(id, promise);
      }
      try {
        url = await promise;
      } finally {
        if (pending.get(id) === promise) pending.delete(id);
      }
      if (ready.size >= 100) ready.delete(ready.keys().next().value!);
      ready.set(id, { url, expires: Date.now() + 5 * 60000 });
    }
    return new Response(null, {
      status: 307,
      headers: { ...headers, Location: url },
    });
  } catch (error) {
    const failure =
      error instanceof HandoffError ? error : new HandoffError('internal');
    console.warn(
      'NZB_HANDOFF_FAILED',
      JSON.stringify({
        stage: failure.stage,
        status: failure.status,
        reason: failure.reason,
        backendHost: failure.backendHost,
        redirectHost: failure.redirectHost,
      })
    );
    return new Response(
      `NZB playback failed at ${failure.stage}${failure.status ? ` (HTTP ${failure.status})` : ''}${failure.reason ? ` [${failure.reason}]` : ''}. Try the direct Easynews HTTP option.`,
      { status: 502, headers }
    );
  }
}
