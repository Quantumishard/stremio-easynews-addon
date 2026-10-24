import { describe, expect, it } from 'vitest';
import {
  createThumbnailUrl,
  isBadVideo,
  matchesTitle,
  sanitizeTitle,
} from './utils.js';
import type { EasynewsSearchResponse, FileData } from '@easynews/api';

describe('sanitizeTitle', () => {
  // See also: https://github.com/sleeyax/stremio-easynews-addon/issues/38#issuecomment-2467015435.
  it.each([
    ['Three Colors: Blue (1993)', 'three colors blue 1993'],
    [
      'Willy Wonka & the Chocolate Factory (1973)',
      'willy wonka and the chocolate factory 1973',
    ],
    ["America's got talent", 'americas got talent'],
    ['WALL-E (2008)', 'wall e 2008'],
    ['WALL·E', 'walle'],
    [
      'Mission: Impossible - Dead Reckoning Part One (2023)',
      'mission impossible dead reckoning part one 2023',
    ],
    [
      'The Lord of the Rings: The Fellowship of the Ring',
      'the lord of the rings the fellowship of the ring',
    ],
    ['Once Upon a Time ... in Hollywood', 'once upon a time in hollywood'],
    ['Am_er-ic.a', 'am er ic a'],
    ['Amérîcâ', 'amérîcâ'],
    ["D'où vient-il?", 'doù vient il'],
    ['Fête du cinéma', 'fête du cinéma'],
  ])("sanitizes the title '%s'", (input, expected) => {
    expect(sanitizeTitle(input)).toBe(expected);
  });
});

describe('matchesTitle', () => {
  it.each([
    // ignore apostrophes
    ["America's Next Top Model", "America's", true],
    ["America's Next Top Model", 'Americas', true],
    // french characters should match exactly
    ['Fête du cinéma', 'cinema', false],
    ['Fête du cinéma', 'cinéma', true],
    ['Fête du cinéma', 'Fete', false],
    ['Fête du cinéma', 'Fête', true],
    // ignore special characters
    ['Am_er-ic.a the Beautiful', 'America the Beautiful', false, true],
    ['Am_er-ic.a the Beautiful', 'Am er ic a the Beautiful', true, false],
    // Match title words even when release names insert extra words between them.
    [
      'Mission Impossible Dead Reckoning Part One 2023 1080p',
      'Mission Impossible Dead Reckoning',
      true,
      false,
    ],
    // Do not match a query word inside another word.
    ['The Witcher S01E01', 'The It', false, false],
  ])(
    "matches the title '%s' with query '%s'",
    (title, query, expected, strict = false) => {
      expect(matchesTitle(title, query, strict)).toBe(expected);
    }
  );

  it('matches a parsed movie title when the query is a title fragment', () => {
    expect(
      matchesTitle(
        'Mission.Impossible.Dead.Reckoning.Part.One.2023.1080p.BluRay.x264',
        'Mission Impossible Dead Reckoning',
        true
      )
    ).toBe(true);
  });
});

describe('isBadVideo', () => {
  it('accepts a transport-stream file that EasyNews does not classify as VIDEO', () => {
    const file = {
      '2': '',
      '11': '.ts',
      '14': '45m',
      passwd: false,
      virus: false,
      type: 'OTHER',
    } as unknown as FileData;

    expect(isBadVideo(file)).toBe(false);
  });

  it('does not reject a supported video because of its reported duration', () => {
    const file = {
      '2': '.mp4',
      '11': '.mp4',
      '14': '2m',
      passwd: false,
      virus: false,
      type: 'VIDEO',
    } as unknown as FileData;

    expect(isBadVideo(file)).toBe(false);
  });
});

it('restores public preview URLs without download suffixes or filename paths', () => {
  const key = 'abc' + 'd'.repeat(38);
  expect(
    createThumbnailUrl(
      { thumbURL: 'https://old.invalid/' } as EasynewsSearchResponse,
      { '0': key + '1234', '10': 'A title / with spaces' } as FileData
    )
  ).toBe(`https://th.easynews.com/thumbnails-abc/pr-${key}.jpg`);
});
