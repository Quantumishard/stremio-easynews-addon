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
      maxResults = 1000,
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
      st: 'adv',
      sb: '1',
      fex: 'm4v,3gp,mov,divx,xvid,wmv,avi,mpg,mpeg,mp4,mkv,avc,flv,webm,ts',
      spamf: '1',
      u: '1',
      gx: '1',
      pno: pageNr.toString(),
      sS: '3',
      s1: sort1,
      s1d: sort1Direction,
      s2: sort2,
      s2d: sort2Direction,
      s3: sort3,
      s3d: sort3Direction,
      pby: maxResults.toString(),
      safeO: '1',
      gps: query,
    };

    const url = new URL(`${this.baseUrl}/2.0/search/solr-search/advanced`);
    url.search = new URLSearchParams(searchParams).toString();

    const res = await fetch(url, {
      headers: this.headers,
      signal: signal ?? AbortSignal.timeout(60_000),
    });

    if (!res.ok) {
      throw new Error(
        `Failed to fetch search results of query '${query}': ${res.status} ${res.statusText}`
      );
    }

    const json = await res.json();

    return json;
  }

  async searchAll(options: SearchOptions): Promise<EasynewsSearchResponse> {
    // Bound broad searches and retain successful pages if a later page fails.
    const signal = AbortSignal.timeout(12_000);
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
