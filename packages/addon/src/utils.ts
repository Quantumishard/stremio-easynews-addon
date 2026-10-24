import { EasynewsSearchResponse, FileData } from '@easynews/api';
import { MetaProviderResponse } from './meta.js';
import { ContentType } from '@stremio-addon/sdk';
import { parse as parseTorrentTitle } from 'parse-torrent-title';

const videoExtensions = new Set([
  '.m4v',
  '.3gp',
  '.mov',
  '.divx',
  '.xvid',
  '.wmv',
  '.avi',
  '.mpg',
  '.mpeg',
  '.mp4',
  '.mkv',
  '.avc',
  '.flv',
  '.webm',
  '.ts',
]);

export function isBadVideo(file: FileData) {
  const extensions = [file['2'], file['11']].map((extension) =>
    extension?.toLowerCase()
  );

  return (
    // password protected
    file.passwd ||
    // malicious
    file.virus ||
    // not a supported video extension. EasyNews does not consistently
    // classify transport-stream files as VIDEO, so rely on the extension.
    !extensions.some((extension) => videoExtensions.has(extension))
  );
}

export function sanitizeTitle(title: string) {
  return (
    title
      // replace common symbols with words
      .replaceAll('&', 'and')
      // replace common separators (., _, -, whitespace) with a single space
      .replace(/[\.\-_:\s]+/g, ' ')
      // remove non-alphanumeric characters except for accented characters
      .replace(/[^\w\sÀ-ÿ]/g, '')
      // to lowercase + remove spaces at the beginning and end
      .toLowerCase()
      .trim()
  );
}

export function matchesTitle(
  title: string,
  query: string,
  strict: boolean
): boolean {
  const sanitizedTitle = sanitizeTitle(title);
  const sanitizedQuery = sanitizeTitle(query);

  if (strict) {
    const { title: movieTitle } = parseTorrentTitle(title);

    if (movieTitle) {
      return sanitizeTitle(movieTitle).includes(sanitizedQuery);
    }
  }

  const queryWords = sanitizedQuery.split(' ').filter(Boolean);

  // Require every query word to appear somewhere in the title,
  // but not necessarily next to each other.
  return (
    queryWords.length > 0 &&
    queryWords.every((word) =>
      new RegExp(`\\b${word}\\b`, 'i').test(sanitizedTitle)
    )
  );
}

export function createStreamUrl(
  {
    downURL,
    dlFarm,
    dlPort,
  }: Pick<EasynewsSearchResponse, 'downURL' | 'dlFarm' | 'dlPort'>,
  usename: String,
  password: String
) {
  const downURLWithAuth = downURL.replace('://', `://${usename}:${password}@`);

  return `${downURLWithAuth}/${dlFarm}/${dlPort}`;
}

export function createStreamPath(file: FileData) {
  const postHash = file['0'] ?? '';
  const postTitle = file['10'] ?? '';
  const ext = file['11'] ?? '';

  return `${postHash}${ext}/${postTitle}${ext}`;
}

export function getFileExtension(file: FileData) {
  return file['2'] ?? '';
}

export function getPostTitle(file: FileData) {
  return file['10'] ?? '';
}

export function getDuration(file: FileData) {
  return file['14'] ?? '';
}

export function getSize(file: FileData) {
  return file['4'] ?? '';
}

export function getQuality(
  title: string,
  fallbackResolution?: string
): string | undefined {
  const { resolution } = parseTorrentTitle(title);
  return resolution ?? fallbackResolution;
}

export function createThumbnailUrl(
  res: EasynewsSearchResponse,
  file: FileData
) {
  // Preview keys omit the download ID suffix and filename slug.
  const id = (file['0'] ?? '').slice(0, 41);
  if (id.length < 3) return undefined;
  return `https://th.easynews.com/thumbnails-${encodeURIComponent(id.slice(0, 3))}/pr-${encodeURIComponent(id)}.jpg`;
}

export function extractDigits(value: string) {
  const match = value.match(/\d+/);

  if (match) {
    return parseInt(match[0], 10);
  }

  return undefined;
}

export function buildSearchQuery(
  type: ContentType,
  meta: MetaProviderResponse
) {
  let query = `${meta.name}`;

  if (type === 'series') {
    if (meta.season) {
      query += ` S${meta.season.toString().padStart(2, '0')}`;
    }

    if (meta.episode) {
      query += `${!meta.season ? ' ' : ''}E${meta.episode.toString().padStart(2, '0')}`;
    }
  }

  if (meta.year) {
    query += ` ${meta.year}`;
  }

  return query;
}

export function logError(message: {
  message: string;
  error: unknown;
  context: unknown;
}) {
  console.error(message);
}

export function capitalizeFirstLetter(str: string): string {
  if (!str) return str;
  return str.charAt(0).toUpperCase() + str.slice(1);
}
