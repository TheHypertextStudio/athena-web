import { describe, expect, it } from 'vitest';

import {
  canonicalizeResourceUrl,
  matchProviderResourceUrl,
  normalizeResourceUrl,
  providerResourceKey,
  webResourceKey,
} from '../src/resource';

describe('normalizeResourceUrl', () => {
  it('rejects anything that is not a parseable http(s) URL', () => {
    expect(normalizeResourceUrl('not a url')).toBeUndefined();
    expect(normalizeResourceUrl('')).toBeUndefined();
    expect(normalizeResourceUrl('mailto:someone@example.com')).toBeUndefined();
    expect(normalizeResourceUrl('javascript:alert(1)')).toBeUndefined();
  });

  it('lowercases the scheme and host but preserves path case', () => {
    expect(normalizeResourceUrl('HTTPS://Example.COM/Path/To/Doc')).toBe(
      'https://example.com/Path/To/Doc',
    );
  });

  it('drops the default port for each scheme but keeps a non-default one', () => {
    expect(normalizeResourceUrl('https://example.com:443/a')).toBe('https://example.com/a');
    expect(normalizeResourceUrl('http://example.com:80/a')).toBe('http://example.com/a');
    expect(normalizeResourceUrl('https://example.com:8443/a')).toBe('https://example.com:8443/a');
  });

  it('sorts parameters, so two spellings of one address dedupe to the same key', () => {
    expect(normalizeResourceUrl('https://example.com/a?c=3&a=1&b=2')).toBe(
      'https://example.com/a?a=1&b=2&c=3',
    );
  });

  it('keeps a repeated parameter, in the order it was written', () => {
    // Two URLs differing only in the order of repeated values are different URLs, so the sort
    // must leave equal keys alone rather than reordering them into a canonical-looking lie.
    expect(normalizeResourceUrl('https://example.com/a?tag=b&tag=a')).toBe(
      'https://example.com/a?tag=b&tag=a',
    );
  });

  it('drops the fragment', () => {
    expect(normalizeResourceUrl('https://example.com/a#section-3')).toBe('https://example.com/a');
  });

  it('strips tracking parameters, keeps identifying ones, and sorts the remainder', () => {
    expect(
      normalizeResourceUrl('https://example.com/a?utm_source=x&page=2&gclid=y&id=7&si=z'),
    ).toBe('https://example.com/a?id=7&page=2');
  });

  it('matches tracking parameters case-insensitively', () => {
    expect(normalizeResourceUrl('https://example.com/a?UTM_Source=x&id=7')).toBe(
      'https://example.com/a?id=7',
    );
  });

  it('keeps repeated keys in their authored order rather than shuffling them', () => {
    expect(normalizeResourceUrl('https://example.com/a?tag=b&tag=a&tag=c')).toBe(
      'https://example.com/a?tag=b&tag=a&tag=c',
    );
  });

  it('leaves two distinct keys already in ascending order untouched', () => {
    expect(normalizeResourceUrl('https://example.com/a?a=1&b=2')).toBe(
      'https://example.com/a?a=1&b=2',
    );
  });

  it('strips a trailing slash from a path but never empties the root', () => {
    expect(normalizeResourceUrl('https://example.com/a/')).toBe('https://example.com/a');
    expect(normalizeResourceUrl('https://example.com/')).toBe('https://example.com/');
  });

  it('collapses two spellings of the same page onto one string', () => {
    const a = normalizeResourceUrl('https://Example.com/docs/?utm_campaign=launch&v=2#top');
    const b = normalizeResourceUrl('https://example.com:443/docs?v=2');
    expect(a).toBe(b);
  });
});

describe('matchProviderResourceUrl', () => {
  it.each([
    ['https://docs.google.com/document/d/abc123/edit', 'abc123', 'document'],
    ['https://docs.google.com/spreadsheets/d/sheet1/edit#gid=0', 'sheet1', 'spreadsheet'],
    ['https://docs.google.com/presentation/d/deck9/view', 'deck9', 'presentation'],
    ['https://docs.google.com/forms/d/form2/viewform', 'form2', 'page'],
    ['https://docs.google.com/drawings/d/draw3/edit', 'draw3', 'image'],
    ['https://drive.google.com/file/d/file4/view?usp=sharing', 'file4', 'file'],
    ['https://drive.google.com/drive/folders/folder5', 'folder5', 'folder'],
  ])('matches %s', (url, externalId, resourceType) => {
    expect(matchProviderResourceUrl(url)).toEqual({
      provider: 'google_drive',
      externalId,
      resourceType,
    });
  });

  it.each(['https://drive.google.com/open?id=legacy1', 'https://drive.google.com/uc?id=legacy1'])(
    'matches the legacy id-query shape %s',
    (url) => {
      expect(matchProviderResourceUrl(url)).toEqual({
        provider: 'google_drive',
        externalId: 'legacy1',
        resourceType: 'unknown',
      });
    },
  );

  it('does not match a lookalike host', () => {
    expect(
      matchProviderResourceUrl('https://docs.google.com.attacker.example/document/d/abc123/edit'),
    ).toBeUndefined();
  });

  it('does not match over plain http, so a downgraded link never receives a token', () => {
    expect(
      matchProviderResourceUrl('http://docs.google.com/document/d/abc123/edit'),
    ).toBeUndefined();
  });

  it('does not match a Google host with no recognizable resource path', () => {
    expect(matchProviderResourceUrl('https://docs.google.com/')).toBeUndefined();
    expect(matchProviderResourceUrl('https://drive.google.com/drive/my-drive')).toBeUndefined();
  });

  it('does not match the legacy shape without a usable id', () => {
    expect(matchProviderResourceUrl('https://drive.google.com/open')).toBeUndefined();
    expect(matchProviderResourceUrl('https://drive.google.com/open?id=')).toBeUndefined();
  });

  it('rejects unparseable input and non-https schemes', () => {
    expect(matchProviderResourceUrl('////')).toBeUndefined();
    expect(matchProviderResourceUrl('javascript:alert(1)')).toBeUndefined();
  });
});

describe('canonicalizeResourceUrl', () => {
  it('collapses two Drive URL shapes for one document onto one key', () => {
    const viaDocs = canonicalizeResourceUrl(
      'https://docs.google.com/document/d/abc123/edit#heading',
    );
    const viaOpen = canonicalizeResourceUrl('https://drive.google.com/open?id=abc123&usp=sharing');
    expect(viaDocs?.canonicalKey).toBe('google_drive:abc123');
    expect(viaOpen?.canonicalKey).toBe('google_drive:abc123');
    expect(viaDocs?.provider).toBe('google_drive');
    expect(viaDocs?.externalId).toBe('abc123');
    expect(viaDocs?.resourceType).toBe('document');
  });

  it('keeps the normalized URL alongside the provider key', () => {
    expect(
      canonicalizeResourceUrl('https://docs.google.com/document/d/abc123/edit')?.canonicalUrl,
    ).toBe('https://docs.google.com/document/d/abc123/edit');
  });

  it('falls back to a web key with no external id for an ordinary page', () => {
    expect(canonicalizeResourceUrl('https://example.com/blog/post?utm_source=news')).toEqual({
      provider: 'web',
      canonicalKey: 'web:https://example.com/blog/post',
      canonicalUrl: 'https://example.com/blog/post',
      externalId: undefined,
      resourceType: 'unknown',
    });
  });

  it('returns undefined for anything that cannot be referenced', () => {
    expect(canonicalizeResourceUrl('mailto:someone@example.com')).toBeUndefined();
  });
});

describe('key builders', () => {
  it('namespaces provider and web keys so they can never collide', () => {
    expect(providerResourceKey('google_drive', 'abc')).toBe('google_drive:abc');
    expect(webResourceKey('https://example.com/a')).toBe('web:https://example.com/a');
  });
});
