import { createBasic } from './utils.js';
import { EasynewsSearchResponse, FileData, SearchOptions } from './types.js';

export class EasynewsAPI {
  private readonly baseUrl = 'https://members.easynews.com';
  private readonly headers: Headers;

  constructor(options: { username: string; password: string }) {
    if (!options) {
      throw new Error('Missing options');
    }

    this.headers = new Headers();
    const basic = createBasic(options.username, options.password);
    this.headers.append('Authorization', basic);
  }

  async search(
    {
      query,
      pageNr = 1,
      sort1 = 'dsize',
      sort1Direction = '-',
      sort2 = 'relevance',
      sort2Direction = '-',
      sort3 = 'dtime',
      sort3Direction = '-',
    }: SearchOptions,
    signal?: AbortSignal
  ): Promise<EasynewsSearchResponse> {
    const searchParams = {
      'fty[]': 'VIDEO',
      u: '1',
      pno: pageNr.toString(),
      s1: sort1,
      s1d: sort1Direction,
      s2: sort2,
      s2d: sort2Direction,
      s3: sort3,
      s3d: sort3Direction,
      safeO: '1',
      gps: query,
    };

    const url = new URL(`${this.baseUrl}/3.0/api/search`);
    url.search = new URLSearchParams(searchParams).toString();

    const res = await fetch(url, {
      headers: this.headers,
      signal: signal ?? AbortSignal.timeout(8_000),
    });

    if (!res.ok) {
      throw new Error(
        `Failed to fetch search results of query '${query}': ${res.status} ${res.statusText}`
      );
    }

    const json = (await res.json()) as EasynewsSearchResponse;
    if (!Array.isArray(json.data)) {
      throw new Error('Invalid Easynews search response');
    }
    // V3 exposes named fields; keep the shared addon's numeric field contract.
    json.downURL ||= `${this.baseUrl}/dl`;
    json.dlFarm ||= 'auto';
    json.dlPort ||= 'auto';
    json.data = json.data.map((file) => {
      const raw = file as unknown as Record<string, unknown>;
      const timestamp = Number(raw.timestamp ?? raw.ts);
      const date = raw['5']
        ? new Date(String(raw['5']))
        : new Date(timestamp * 1000);
      const posted = Number.isFinite(date.getTime())
        ? date.toISOString()
        : new Date(0).toISOString();
      const extension = String(raw['11'] ?? raw.extension ?? raw.ext ?? '');
      return {
        ...file,
        '0': file['0'] ?? `${file.hash ?? ''}${file.id ?? ''}`,
        '2': file['2'] ?? extension,
        '4':
          file['4'] ?? String(raw.prettySize ?? raw.rawSize ?? raw.size ?? ''),
        '5': String(posted),
        '6': file['6'] ?? file.subject,
        '10': file['10'] ?? file.fn,
        '11': extension,
        '14': String(file['14'] ?? raw.prettyRuntime ?? ''),
        rawSize: Number(raw.rawSize ?? raw.size) || 0,
        passwd: file.passwd ?? raw.password === true,
        fullres: file.fullres ?? (raw.yres ? `${raw.yres}p` : ''),
        type: file.type ?? 'VIDEO',
      } as FileData;
    });

    return json;
  }

  async searchAll(options: SearchOptions): Promise<EasynewsSearchResponse> {
    // Bound broad searches and retain successful pages if a later page fails.
    const signal = AbortSignal.timeout(8_000);
    const limit = Math.max(
      1,
      Math.min(1000, Math.floor(options.maxResults ?? 1000) || 1000)
    );
    const perPage = Math.min(100, limit);
    const first = await this.search(
      { ...options, pageNr: 1, maxResults: perPage },
      signal
    );
    const data: FileData[] = [];
    const seen = new Set<string>();
    const append = (page: EasynewsSearchResponse) => {
      for (const file of page.data ?? []) {
        if (seen.has(file['0']) || data.length >= limit) continue;
        seen.add(file['0']);
        data.push(file);
      }
    };
    append(first);
    const reportedPages =
      Number(first.numPages) || Math.ceil(Number(first.results) / perPage) || 1;
    const maxPages = Math.min(10, Math.ceil(limit / perPage), reportedPages);
    for (
      let pageNr = 2;
      data.length < limit &&
      pageNr <= maxPages &&
      !signal.aborted &&
      first.data?.length;
      pageNr += 3
    ) {
      const pages = await Promise.allSettled(
        Array.from({ length: Math.min(3, maxPages - pageNr + 1) }, (_, index) =>
          this.search(
            { ...options, pageNr: pageNr + index, maxResults: perPage },
            signal
          )
        )
      );
      for (const page of pages) {
        if (page.status === 'fulfilled') append(page.value);
      }
    }
    return { ...first, data, returned: data.length };
  }
}
