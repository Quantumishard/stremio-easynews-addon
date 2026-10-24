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

  async search({
    query,
    pageNr = 1,
    maxResults = 100,
    sort1 = 'dsize',
    sort1Direction = '-',
    sort2 = 'relevance',
    sort2Direction = '-',
    sort3 = 'dtime',
    sort3Direction = '-',
  }: SearchOptions): Promise<EasynewsSearchResponse> {
    const searchParams = {
      st: 'adv',
      sb: '1',
      fex: 'm4v,3gp,mov,divx,xvid,wmv,avi,mpg,mpeg,mp4,mkv,avc,flv,webm,ts',
      'fty[]': 'VIDEO',
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

    const url = new URL(`${this.baseUrl}/3.0/api/search`);
    url.search = new URLSearchParams(searchParams).toString();

    const res = await fetch(url, {
      headers: this.headers,
      signal: AbortSignal.timeout(20_000), // 20 seconds
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
    json.data = json.data.map(
      (file) =>
        ({
          ...file,
          '0': file['0'] ?? `${file.hash ?? ''}${file.id ?? ''}`,
          '2': file['2'] ?? file.extension,
          '5':
            file['5'] ??
            (Number.isFinite(file.ts)
              ? new Date(file.ts * 1000).toISOString()
              : ''),
          '6': file['6'] ?? file.subject,
          '10': file['10'] ?? file.fn,
          '11': file['11'] ?? file.extension,
          '14': file['14'] ?? '',
          type: file.type ?? 'VIDEO',
        }) as FileData
    );

    return json;
  }

  async searchAll(options: SearchOptions): Promise<EasynewsSearchResponse> {
    const data: FileData[] = [];
    let res: EasynewsSearchResponse;
    let pageNr = 1;

    const seen = new Set<string>();
    while (true) {
      res = await this.search({ ...options, pageNr });

      // No more results.
      if (
        (res.data ?? []).length === 0 ||
        data[0]?.['0'] === res.data[0]?.['0']
      ) {
        break;
      }

      const fresh = res.data.filter((file) => {
        if (seen.has(file['0'])) return false;
        seen.add(file['0']);
        return true;
      });
      if (fresh.length === 0) break;
      data.push(...fresh);

      if (pageNr >= res.numPages) break;

      pageNr++;
    }

    res.data = data;

    return res;
  }
}
