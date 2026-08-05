import { describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';

import { MockUnfurler, parseHeadMetadata, RealUnfurler } from '../src/unfurl';
import type { safeOutboundFetch } from '../src/safe-fetch';

/** The exact shape `RealUnfurler` accepts as its injectable transport. */
type FetchImpl = typeof safeOutboundFetch;

/** Build a fetch boundary stub that always resolves to one canned `Response`. */
function respondWith(body: string | null, init: ResponseInit = {}): Mock<FetchImpl> {
  return vi.fn<FetchImpl>(async () => new Response(body, init));
}

/** Build a fetch boundary stub that always rejects/throws before producing a `Response`. */
function failingWith(error: unknown): Mock<FetchImpl> {
  return vi.fn<FetchImpl>(async () => {
    throw error;
  });
}

describe('parseHeadMetadata', () => {
  it('prefers og:title and og:description over the Twitter card and the plain HTML title', () => {
    const html = `<html><head>
      <title>Padded Document Title - My Site</title>
      <meta name="twitter:title" content="Twitter Title">
      <meta name="twitter:description" content="Twitter description">
      <meta property="og:title" content="OG Title">
      <meta property="og:description" content="OG description">
    </head><body></body></html>`;
    const metadata = parseHeadMetadata(html, 'https://example.com/page');
    expect(metadata.title).toBe('OG Title');
    expect(metadata.description).toBe('OG description');
  });

  it('falls back to the Twitter card when OpenGraph is absent', () => {
    const html = `<head>
      <title>Doc Title</title>
      <meta name="twitter:title" content="Twitter Title">
      <meta name="twitter:description" content="Twitter description">
    </head>`;
    const metadata = parseHeadMetadata(html, 'https://example.com/page');
    expect(metadata.title).toBe('Twitter Title');
    expect(metadata.description).toBe('Twitter description');
  });

  it('falls back to the plain <title> and meta description when neither card is present', () => {
    const html = `<head>
      <title>Just a Document</title>
      <meta name="description" content="Just a page">
    </head>`;
    const metadata = parseHeadMetadata(html, 'https://example.com/page');
    expect(metadata.title).toBe('Just a Document');
    expect(metadata.description).toBe('Just a page');
  });

  it('treats an empty og:title as absent rather than a blank string', () => {
    const html = `<head>
      <meta property="og:title" content="">
      <title>Real Title</title>
    </head>`;
    const metadata = parseHeadMetadata(html, 'https://example.com/page');
    expect(metadata.title).toBe('Real Title');
  });

  it('treats an entirely absent title as undefined, not an empty string', () => {
    const html = `<head><title></title></head>`;
    const metadata = parseHeadMetadata(html, 'https://example.com/page');
    expect(metadata.title).toBeUndefined();
  });

  it('treats an empty og:description as absent rather than a blank string', () => {
    const html = `<head><meta property="og:description" content=""></head>`;
    const metadata = parseHeadMetadata(html, 'https://example.com/page');
    expect(metadata.description).toBeUndefined();
  });

  it('decodes the HTML entities that show up in real titles and descriptions', () => {
    const html = `<head>
      <meta property="og:title" content="Tom &amp; Jerry &lt;Show&gt; &quot;Live&quot; &#39;Tour&#39;&nbsp;&apos;2026&apos;">
    </head>`;
    const metadata = parseHeadMetadata(html, 'https://example.com/page');
    expect(metadata.title).toBe("Tom & Jerry <Show> \"Live\" 'Tour' '2026'");
  });

  it("uses og:site_name when present, and the page's own hostname otherwise", () => {
    const withSiteName = parseHeadMetadata(
      '<head><meta property="og:site_name" content="Acme Docs"></head>',
      'https://docs.acme.example/page',
    );
    expect(withSiteName.siteName).toBe('Acme Docs');

    const withoutSiteName = parseHeadMetadata('<head></head>', 'https://docs.acme.example/page');
    expect(withoutSiteName.siteName).toBe('docs.acme.example');
  });

  it('resolves a declared icon link against the final URL, preferring the first one declared', () => {
    const html = `<head>
      <link rel="apple-touch-icon" href="/first-icon.png">
      <link rel="icon" href="/second-icon.png">
    </head>`;
    const metadata = parseHeadMetadata(html, 'https://example.com/deep/page');
    expect(metadata.iconUrl).toBe('https://example.com/first-icon.png');
  });

  it('recognizes icon, shortcut, and apple-touch-icon among space-separated rel tokens', () => {
    const html = `<head><link rel="shortcut icon" href="/shortcut.png"></head>`;
    const metadata = parseHeadMetadata(html, 'https://example.com/page');
    expect(metadata.iconUrl).toBe('https://example.com/shortcut.png');
  });

  it('falls back to the conventional /favicon.ico path when no icon link is declared', () => {
    const metadata = parseHeadMetadata('<head></head>', 'https://example.com/deep/page');
    expect(metadata.iconUrl).toBe('https://example.com/favicon.ico');
  });

  it('skips a <link> tag that declares no rel at all', () => {
    const html = `<head><link href="/no-rel-here.png"></head>`;
    const metadata = parseHeadMetadata(html, 'https://example.com/page');
    expect(metadata.iconUrl).toBe('https://example.com/favicon.ico');
  });

  it('ignores a <link> whose rel does not name an icon, such as a stylesheet', () => {
    const html = `<head><link rel="stylesheet" href="/style.css"></head>`;
    const metadata = parseHeadMetadata(html, 'https://example.com/page');
    expect(metadata.iconUrl).toBe('https://example.com/favicon.ico');
  });

  it('drops an http (non-https) icon or image link instead of resolving it', () => {
    const html = `<head>
      <link rel="icon" href="http://example.com/icon.png">
      <meta property="og:image" content="http://example.com/thumb.png">
    </head>`;
    const metadata = parseHeadMetadata(html, 'https://example.com/page');
    // No usable https icon survives, so it falls back to the conventional path.
    expect(metadata.iconUrl).toBe('https://example.com/favicon.ico');
    expect(metadata.thumbnailUrl).toBeUndefined();
  });

  it('drops a malformed icon href instead of throwing', () => {
    const html = `<head><link rel="icon" href="https://[gg]"></head>`;
    const metadata = parseHeadMetadata(html, 'https://example.com/page');
    expect(metadata.iconUrl).toBe('https://example.com/favicon.ico');
  });

  it('resolves og:image over twitter:image into an absolute https thumbnail URL', () => {
    const html = `<head>
      <meta name="twitter:image" content="/twitter-thumb.png">
      <meta property="og:image" content="/thumb.png">
    </head>`;
    const metadata = parseHeadMetadata(html, 'https://example.com/deep/page');
    expect(metadata.thumbnailUrl).toBe('https://example.com/thumb.png');
  });

  it.each([
    ['video', 'video'],
    ['video.movie', 'video'],
    ['image', 'image'],
    ['image.jpeg', 'image'],
    ['article', 'page'],
    ['website', 'page'],
    ['music.song', 'page'],
  ] as const)('maps og:type %s onto resourceType %s', (ogType, expected) => {
    const metadata = parseHeadMetadata(
      `<head><meta property="og:type" content="${ogType}"></head>`,
      'https://example.com/page',
    );
    expect(metadata.resourceType).toBe(expected);
  });

  it('treats a missing og:type as a plain page', () => {
    const metadata = parseHeadMetadata('<head></head>', 'https://example.com/page');
    expect(metadata.resourceType).toBe('page');
  });

  it('keeps only the first value for a repeated meta key', () => {
    const html = `<head>
      <meta property="og:title" content="First">
      <meta property="og:title" content="Second">
    </head>`;
    const metadata = parseHeadMetadata(html, 'https://example.com/page');
    expect(metadata.title).toBe('First');
  });

  it('ignores a meta tag that has neither a usable name/property nor a content attribute', () => {
    const html = `<head>
      <meta charset="utf-8">
      <meta property="og:title">
      <title>Fallback Title</title>
    </head>`;
    const metadata = parseHeadMetadata(html, 'https://example.com/page');
    expect(metadata.title).toBe('Fallback Title');
  });

  it('reads single-quoted and unquoted attribute values, not just double-quoted ones', () => {
    const html = `<head><meta property='og:title' content='Single Quoted'></head>`;
    expect(parseHeadMetadata(html, 'https://example.com/page').title).toBe('Single Quoted');

    const unquoted = `<head><meta property=og:title content=UnquotedTitle></head>`;
    expect(parseHeadMetadata(unquoted, 'https://example.com/page').title).toBe('UnquotedTitle');
  });

  it('only examines content before </head>, ignoring anything declared in the body', () => {
    const html = `<head><title>Head Title</title></head>
      <body><meta property="og:title" content="Body Title Should Be Ignored"></body>`;
    const metadata = parseHeadMetadata(html, 'https://example.com/page');
    expect(metadata.title).toBe('Head Title');
  });

  it('still parses correctly when the document has no closing </head> tag at all', () => {
    const html = `<html><head><title>No Closing Tag</title>`;
    const metadata = parseHeadMetadata(html, 'https://example.com/page');
    expect(metadata.title).toBe('No Closing Tag');
  });
});

describe('RealUnfurler', () => {
  it('reports unsupported for a string that is not a URL at all', async () => {
    const unfurler = new RealUnfurler(respondWith('<head></head>'));
    await expect(unfurler.unfurl('not a url')).resolves.toEqual({ status: 'unsupported' });
  });

  it('reports unsupported for a non-https URL rather than fetching it', async () => {
    const fetchImpl = respondWith('<head></head>');
    const unfurler = new RealUnfurler(fetchImpl);
    await expect(unfurler.unfurl('http://example.com/page')).resolves.toEqual({
      status: 'unsupported',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('fetches with a GET request accepting HTML, using the parsed URL object', async () => {
    const fetchImpl = respondWith('<head><title>Hi</title></head>', {
      status: 200,
      headers: { 'content-type': 'text/html' },
    });
    const unfurler = new RealUnfurler(fetchImpl);
    await unfurler.unfurl('https://example.com/page');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as [URL, RequestInit];
    expect(url).toBeInstanceOf(URL);
    expect(url.toString()).toBe('https://example.com/page');
    expect(init).toMatchObject({
      method: 'GET',
      headers: { accept: 'text/html,application/xhtml+xml' },
    });
  });

  it('reports a failed outcome carrying the HTTP status when the response is not ok', async () => {
    const fetchImpl = respondWith('server error', { status: 503 });
    const unfurler = new RealUnfurler(fetchImpl);
    await expect(unfurler.unfurl('https://example.com/page')).resolves.toEqual({
      status: 'failed',
      reason: 'http_503',
    });
  });

  it('reports a failed outcome carrying the error name when the transport throws an Error', async () => {
    const fetchImpl = failingWith(new TypeError('network down'));
    const unfurler = new RealUnfurler(fetchImpl);
    await expect(unfurler.unfurl('https://example.com/page')).resolves.toEqual({
      status: 'failed',
      reason: 'TypeError',
    });
  });

  it("reports 'unknown' when the transport throws something that is not an Error", async () => {
    const fetchImpl = failingWith('connection reset');
    const unfurler = new RealUnfurler(fetchImpl);
    await expect(unfurler.unfurl('https://example.com/page')).resolves.toEqual({
      status: 'failed',
      reason: 'unknown',
    });
  });

  it('parses HTML head metadata for a text/html response, tolerating a charset parameter', async () => {
    const fetchImpl = respondWith('<head><title>Hello World</title></head>', {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    });
    const unfurler = new RealUnfurler(fetchImpl);
    const outcome = await unfurler.unfurl('https://example.com/page');
    expect(outcome.status).toBe('ok');
    if (outcome.status === 'ok') {
      expect(outcome.metadata.title).toBe('Hello World');
      expect(outcome.metadata.resourceType).toBe('page');
    }
  });

  it('parses an application/xhtml+xml response as HTML too', async () => {
    const fetchImpl = respondWith('<head><title>XHTML Doc</title></head>', {
      status: 200,
      headers: { 'content-type': 'application/xhtml+xml' },
    });
    const unfurler = new RealUnfurler(fetchImpl);
    const outcome = await unfurler.unfurl('https://example.com/page');
    expect(outcome.status).toBe('ok');
    if (outcome.status === 'ok') expect(outcome.metadata.title).toBe('XHTML Doc');
  });

  it('describes a non-HTML response from its headers instead of trying to parse the body', async () => {
    const fetchImpl = respondWith(null, {
      status: 200,
      headers: { 'content-type': 'image/png' },
    });
    const unfurler = new RealUnfurler(fetchImpl);
    const outcome = await unfurler.unfurl('https://example.com/reports/summary.png');
    expect(outcome.status).toBe('ok');
    if (outcome.status === 'ok') {
      expect(outcome.metadata).toMatchObject({
        title: 'summary.png',
        description: undefined,
        siteName: 'example.com',
        resourceType: 'image',
        thumbnailUrl: undefined,
      });
      expect(outcome.metadata.iconUrl).toBe('https://example.com/favicon.ico');
    }
  });

  it.each([
    ['image/jpeg', 'image'],
    ['video/mp4', 'video'],
    ['application/pdf', 'pdf'],
    ['application/octet-stream', 'file'],
  ] as const)('maps a %s response into resourceType %s', async (contentType, expected) => {
    const fetchImpl = respondWith(null, { status: 200, headers: { 'content-type': contentType } });
    const unfurler = new RealUnfurler(fetchImpl);
    const outcome = await unfurler.unfurl('https://example.com/file.bin');
    expect(outcome.status).toBe('ok');
    if (outcome.status === 'ok') expect(outcome.metadata.resourceType).toBe(expected);
  });

  it('treats a response with no content-type header at all as non-parseable', async () => {
    const fetchImpl = respondWith(null, { status: 200 });
    const unfurler = new RealUnfurler(fetchImpl);
    const outcome = await unfurler.unfurl('https://example.com/mystery');
    expect(outcome.status).toBe('ok');
    if (outcome.status === 'ok') expect(outcome.metadata.resourceType).toBe('file');
  });

  it('derives the title from a decoded, percent-encoded last path segment', async () => {
    const fetchImpl = respondWith(null, {
      status: 200,
      headers: { 'content-type': 'application/pdf' },
    });
    const unfurler = new RealUnfurler(fetchImpl);
    const outcome = await unfurler.unfurl('https://example.com/files/My%20Report.pdf');
    expect(outcome.status).toBe('ok');
    if (outcome.status === 'ok') expect(outcome.metadata.title).toBe('My Report.pdf');
  });

  it('leaves the title undefined when a non-HTML URL has no final path segment', async () => {
    const fetchImpl = respondWith(null, {
      status: 200,
      headers: { 'content-type': 'application/octet-stream' },
    });
    const unfurler = new RealUnfurler(fetchImpl);
    const outcome = await unfurler.unfurl('https://example.com/');
    expect(outcome.status).toBe('ok');
    if (outcome.status === 'ok') expect(outcome.metadata.title).toBeUndefined();
  });

  it('resolves relative links against the final URL after a redirect, not the requested one', async () => {
    const response = new Response('<head><link rel="icon" href="/moved-icon.png"></head>', {
      status: 200,
      headers: { 'content-type': 'text/html' },
    });
    Object.defineProperty(response, 'url', { value: 'https://redirected.example/final-page' });
    const fetchImpl: FetchImpl = vi.fn(async () => response);
    const unfurler = new RealUnfurler(fetchImpl);
    const outcome = await unfurler.unfurl('https://example.com/original');
    expect(outcome.status).toBe('ok');
    if (outcome.status === 'ok') {
      expect(outcome.metadata.iconUrl).toBe('https://redirected.example/moved-icon.png');
      expect(outcome.metadata.siteName).toBe('redirected.example');
    }
  });

  it('falls back to the requested URL when the response reports no final URL', async () => {
    const fetchImpl = respondWith(null, {
      status: 200,
      headers: { 'content-type': 'application/octet-stream' },
    });
    const unfurler = new RealUnfurler(fetchImpl);
    const outcome = await unfurler.unfurl('https://example.com/doc');
    expect(outcome.status).toBe('ok');
    if (outcome.status === 'ok') expect(outcome.metadata.siteName).toBe('example.com');
  });

  it('constructs with a working default outbound fetch boundary when none is injected', () => {
    expect(() => new RealUnfurler()).not.toThrow();
  });
});

describe('MockUnfurler', () => {
  it('reports unsupported for an invalid URL', async () => {
    const outcome = await new MockUnfurler().unfurl('not a url');
    expect(outcome).toEqual({ status: 'unsupported' });
  });

  it('reports unsupported for a non-https URL', async () => {
    const outcome = await new MockUnfurler().unfurl('http://example.com/page');
    expect(outcome).toEqual({ status: 'unsupported' });
  });

  it('derives a readable title from the last path segment, replacing dashes and underscores', async () => {
    const outcome = await new MockUnfurler().unfurl('https://example.com/my-cool_launch-plan');
    expect(outcome.status).toBe('ok');
    if (outcome.status === 'ok') {
      expect(outcome.metadata.title).toBe('my cool launch plan (example.com)');
      expect(outcome.metadata.siteName).toBe('example.com');
      expect(outcome.metadata.iconUrl).toBe('https://example.com/favicon.ico');
      expect(outcome.metadata.resourceType).toBe('page');
    }
  });

  it('falls back to the hostname as the slug when the URL has no path segments', async () => {
    const outcome = await new MockUnfurler().unfurl('https://example.com/');
    expect(outcome.status).toBe('ok');
    if (outcome.status === 'ok') expect(outcome.metadata.title).toBe('example.com (example.com)');
  });

  it('is deterministic: the same URL always produces the same metadata', async () => {
    const unfurler = new MockUnfurler();
    const first = await unfurler.unfurl('https://example.com/a/b/report');
    const second = await unfurler.unfurl('https://example.com/a/b/report');
    expect(first).toEqual(second);
  });
});
