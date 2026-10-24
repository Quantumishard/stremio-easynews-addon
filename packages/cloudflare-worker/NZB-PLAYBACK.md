# Cloudflare Worker setup: Easynews HTTP + optional AIOStreams NZB playback

This branch backs up the custom Worker based on
[sleeyax/stremio-easynews-addon](https://github.com/sleeyax/stremio-easynews-addon).
It retains direct Easynews HTTP playback and adds an optional **NZB** choice.
The NZB choice searches no separate indexer: it retrieves an NZB for the selected
Easynews result, imports it into AIOStreams, and redirects the player to its stream.
Nothing is imported until that choice is selected. AIOStreams handles video bytes,
NNTP retrieval, buffering, Range requests, and seeking.

The backup also contains the public-thumbnail URL fix and short response caches.
Catalog queries retrieve up to 1,000 candidates in 100-result pages, with at most
three concurrent page requests and a shared 12-second deadline. Later-page errors
retain successful results. Title and video filtering can reduce the displayed count.
It preserves the currently deployed search implementation; it does not incorporate
the separate API v3 work automatically.

## Requirements

- Node.js 22 or newer, npm, Git, and a Cloudflare Workers account.
- An active Easynews account for search and HTTP playback.
- For NZB playback: a private AIOStreams instance reachable from Cloudflare over
  HTTPS, with its built-in Usenet engine and NNTP providers configured.
- An AIOStreams administrator account accepted by `/api/v1/auth/login`.
  The dashboard library API must also accept server-to-server requests.

The Worker-to-self-hosted-AIOStreams handoff and Harbor playback were confirmed
working. The tested ElfHosted instance blocked these API requests with HTTP 403.
Harbor's separate browser sign-in integration is not implemented in this Worker.
The restored public-thumbnail builder passes automated checks; image display in
each client should still be checked after refreshing cached results.

## 1. Clone and deploy

```powershell
git clone --branch custom/cloudflare-nzb-worker https://github.com/Quantumishard/stremio-easynews-addon.git
cd stremio-easynews-addon
npm ci
npm run build
npm test
npm exec -w packages/cloudflare-worker -- wrangler login
```

Edit `packages/cloudflare-worker/wrangler.toml` and give `name` a unique Worker
name in your Cloudflare account. The file contains no account ID or credentials.

```powershell
npm run deploy:cloudflare-worker
```

Save the HTTPS Worker URL printed by Wrangler. Opening its root page gives the
addon configuration form. HTTP works without the four optional NZB settings.

## 2. Enable NZB playback

Enter each setting interactively; never put real values in source files or Git:

```powershell
npm exec -w packages/cloudflare-worker -- wrangler secret put AIOSTREAMS_URL
npm exec -w packages/cloudflare-worker -- wrangler secret put AIOSTREAMS_USERNAME
npm exec -w packages/cloudflare-worker -- wrangler secret put AIOSTREAMS_PASSWORD
npm exec -w packages/cloudflare-worker -- wrangler secret put PLAYBACK_TOKEN_SECRET
```

| Setting                 | Value                                                                                                  |
| ----------------------- | ------------------------------------------------------------------------------------------------------ |
| `AIOSTREAMS_URL`        | HTTPS base URL, such as `https://aiostreams.example.com`; no manifest path, user info, or query string |
| `AIOSTREAMS_USERNAME`   | AIOStreams administrator username                                                                      |
| `AIOSTREAMS_PASSWORD`   | That administrator's password                                                                          |
| `PLAYBACK_TOKEN_SECRET` | A new cryptographically random secret of at least 32 characters                                        |

Generate the last value locally, then paste it into Wrangler's secret prompt:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Keep this secret stable. Replacing it invalidates existing playback and private
thumbnail links. Secrets stay in Cloudflare and must be configured again if you
recreate the Worker; this source backup deliberately does not contain them.

Open `https://YOUR-WORKER.workers.dev/health`. `nzbEnabled` and all configuration
checks should be `true`. This endpoint checks presence, not successful login or
network reachability, and contains no secret values.

For local development only, an untracked `.dev.vars` file can hold these settings
inside `packages/cloudflare-worker`. `.env*`, `.dev.vars*`, `.wrangler`, logs,
NZB downloads, and local work/output folders are ignored by Git. Do not commit
configured manifest URLs, session cookies, signed stream URLs, or account dumps.

## 3. Install in Harbor/Stremio or through AIOStreams

1. Open your Worker root URL and enter your Easynews credentials in its addon
   configuration form. Install or copy the generated manifest privately.
2. If using AIOStreams as an aggregator, add this Worker as a **Custom addon**.
   Enable **Result Passthrough** and **Format Passthrough** for that addon so
   filtering/formatting does not collapse the HTTP and NZB choices.
3. Refresh the Easynews search catalog. Supported results should show the original
   HTTP stream and an additional stream whose name ends in **NZB**.
4. Select NZB. Confirm the release appears in your AIOStreams Usenet library and
   playback starts. Then check seeking and the separate HTTP option.
5. Search again after a minute if stale metadata remains. Aggregators and clients
   may apply their own caches in addition to the Worker's 60-second response cache.

The original configured addon URL can contain Easynews credentials. Treat it as
private even though this repository is public. Encrypted `/play/` links are also
private bearer links, valid for ten days. Do not publish them in bug reports.

## Troubleshooting

- **Only HTTP appears:** check `/health`, refresh metadata, and check the Custom
  addon's passthrough settings. All four optional secrets are required.
- **NZB import fails:** the response identifies a handoff stage. Check AIOStreams
  admin access, NNTP configuration, and API reachability from Cloudflare. A working
  browser dashboard alone does not prove Worker access is allowed.
- **HTTP 403 from hosted APIs:** use a supported hosting API access method or a
  reachable self-hosted instance. Copying browser session cookies into this Worker
  is not an implemented integration.
- **Blank thumbnails:** this version uses the public
  `https://th.easynews.com/thumbnails-{prefix}/pr-{41-character-key}.jpg` pattern.
  It removes the download suffix and obsolete filename path. Refresh cached search
  results; check that your client can reach that image host.
- **Runtime fetch errors:** Worker fetches use `manual` redirects with explicit
  destination checks. Do not replace them with `redirect: 'error'`; the workerd
  runtime used during validation rejected that mode.

## Limits and validation

- NZB downloads are limited to 16 MiB; import/inspection has a 45-second budget.
- A sole video or unique matching filename is selected automatically. Ambiguous
  multi-video NZBs fail rather than selecting an arbitrary video.
- The short pending/result cache is per Worker isolate. AIOStreams retains imports;
  separate isolates may submit the same NZB, which AIOStreams identifies by hash.
- Failed NZB playback does not silently switch to HTTP; HTTP remains selectable.
- Catalog selections retain their Easynews signature. Ordinary movie/episode
  streams use the signature-optional retrieval form and need separate live checks.
- The backup includes automated redirect, thumbnail, metadata, and handoff tests.
  Mocked tests do not prove compatibility with every AIOStreams deployment.

To disable NZB results while keeping HTTP, remove an optional setting, for example:

```powershell
npm exec -w packages/cloudflare-worker -- wrangler secret delete AIOSTREAMS_URL
```

Public thumbnails continue to work without the optional NZB configuration.
The original MIT license and upstream attribution are retained.
