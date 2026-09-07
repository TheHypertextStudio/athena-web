import { describe, expect, it } from 'vitest';

import {
  DOCUMENT_FIGURE_VERSION,
  altTextFromFilename,
  documentFigurePlainText,
  documentImageIdFromSource,
  extractDocumentFigures,
  parseDocumentFigureHtml,
  serializeDocumentFigure,
  type DocumentFigure,
} from '../src/index';

const completeFigure: DocumentFigure = {
  version: 1,
  src: '/v1/orgs/org_1/images/image_1',
  alt: 'A train arriving at a platform',
  decorative: false,
  caption: 'The first train of the morning.',
  creditText: 'Photo by Ada Rivera',
  sourceUrl: 'https://example.com/photos/train',
  licenseText: 'CC BY 4.0',
  licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
};

describe('document figure codec', () => {
  it('round trips every version 1 field through the restricted semantic HTML shape', () => {
    const html = serializeDocumentFigure(completeFigure);

    expect(html).toBe(
      [
        '<figure data-docket-figure="1" data-decorative="false" itemscope itemtype="https://schema.org/ImageObject">',
        '<img src="/v1/orgs/org_1/images/image_1" alt="A train arriving at a platform" itemprop="contentUrl">',
        '<figcaption><span data-docket-caption itemprop="caption">The first train of the morning.</span><span data-docket-attribution><span data-docket-credit itemprop="creditText">Photo by Ada Rivera</span><a data-docket-source href="https://example.com/photos/train">Source</a><a data-docket-license href="https://creativecommons.org/licenses/by/4.0/" rel="license" itemprop="license">CC BY 4.0</a></span></figcaption>',
        '</figure>',
      ].join('\n'),
    );
    expect(parseDocumentFigureHtml(html)).toEqual(completeFigure);
    expect(DOCUMENT_FIGURE_VERSION).toBe(1);
  });

  it('omits the figcaption when caption and attribution are absent', () => {
    const figure: DocumentFigure = {
      version: 1,
      src: 'https://cdn.example.com/diagram.webp',
      alt: 'Service diagram',
      decorative: false,
    };

    const html = serializeDocumentFigure(figure);

    expect(html).not.toContain('<figcaption>');
    expect(parseDocumentFigureHtml(html)).toEqual(figure);
  });

  it('preserves a license URL that has no authored license label', () => {
    const figure: DocumentFigure = {
      version: 1,
      src: 'https://cdn.example.com/diagram.webp',
      alt: 'Service diagram',
      decorative: false,
      licenseUrl: 'https://example.com/license',
    };

    expect(parseDocumentFigureHtml(serializeDocumentFigure(figure))).toEqual(figure);
  });

  it('serializes caption-only and text-only license variants', () => {
    const captionOnly: DocumentFigure = {
      version: 1,
      src: '/v1/orgs/org_1/images/image_1',
      alt: 'Bus shelter rendering',
      decorative: false,
      caption: 'Proposed shelter at Oak Street.',
    };
    const textLicenseOnly: DocumentFigure = {
      version: 1,
      src: '/v1/orgs/org_1/images/image_1',
      alt: 'Bus shelter rendering',
      decorative: false,
      licenseText: 'Public domain',
    };

    expect(parseDocumentFigureHtml(serializeDocumentFigure(captionOnly))).toEqual(captionOnly);
    expect(parseDocumentFigureHtml(serializeDocumentFigure(textLicenseOnly))).toEqual(
      textLicenseOnly,
    );
  });

  it('writes an empty alt attribute for a decorative figure', () => {
    const html = serializeDocumentFigure({
      ...completeFigure,
      alt: 'This text must not reach the output',
      decorative: true,
    });

    expect(html).toContain('data-decorative="true"');
    expect(html).toContain('alt=""');
    expect(parseDocumentFigureHtml(html)?.alt).toBe('');
  });

  it('escapes authored text and attributes without changing their round-trip values', () => {
    const figure: DocumentFigure = {
      version: 1,
      src: 'https://example.com/image?a=1&b=2',
      alt: 'A "quoted" <train> & platform',
      decorative: false,
      caption: "It's <early> & cold.",
      creditText: 'A & B',
      sourceUrl: 'https://example.com/source?a=1&b=2',
      licenseText: 'Use <with> care',
      licenseUrl: 'https://example.com/license?a=1&b=2',
    };

    const html = serializeDocumentFigure(figure);

    expect(html).toContain('&quot;quoted&quot;');
    expect(html).toContain('&lt;train&gt; &amp; platform');
    expect(html).not.toContain('<train>');
    expect(parseDocumentFigureHtml(html)).toEqual(figure);
  });

  it.each([
    'javascript:alert(1)',
    'data:image/png;base64,abc',
    'http://example.com/image.png',
    '//example.com/image.png',
  ])('refuses the unsafe image source %s', (src) => {
    expect(() => serializeDocumentFigure({ ...completeFigure, src })).toThrow(
      'Figure image URLs must use HTTPS or an application-relative path.',
    );
  });

  it('refuses unsafe source and license links', () => {
    expect(() =>
      serializeDocumentFigure({ ...completeFigure, sourceUrl: 'javascript:alert(1)' }),
    ).toThrow('Figure attribution URLs must use HTTPS.');
    expect(() =>
      serializeDocumentFigure({ ...completeFigure, licenseUrl: 'http://example.com/license' }),
    ).toThrow('Figure attribution URLs must use HTTPS.');
  });

  it.each([
    '<figure><img src="https://example.com/a.png" alt="A"></figure>',
    '<figure data-docket-figure="2"><img src="https://example.com/a.png" alt="A"></figure>',
    '<figure data-docket-figure="1" data-decorative="false"><script>alert(1)</script></figure>',
    '<div data-docket-figure="1"><img src="https://example.com/a.png" alt="A"></div>',
  ])('does not accept malformed or unsupported HTML: %s', (html) => {
    expect(parseDocumentFigureHtml(html)).toBeNull();
  });

  it.each([
    [
      [
        '<figure data-docket-figure="1" data-decorative="false" itemscope itemtype="https://schema.org/ImageObject">',
        '<img src="/v1/orgs/org_1/images/image_1" alt="A" itemprop="contentUrl">',
        '<figcaption>Unsupported phrasing</figcaption>',
        '</figure>',
      ].join('\n'),
    ],
    [
      [
        '<figure data-docket-figure="1" data-decorative="false" itemscope itemtype="https://schema.org/ImageObject">',
        '<img src="/v1/orgs/org_1/images/image_1" alt="A" itemprop="contentUrl">',
        '<figcaption><span data-docket-attribution>Unsupported attribution</span></figcaption>',
        '</figure>',
      ].join('\n'),
    ],
    [
      [
        '<figure data-docket-figure="1" data-decorative="false" itemscope itemtype="https://schema.org/ImageObject">',
        '<img src="javascript:alert(1)" alt="A" itemprop="contentUrl">',
        '</figure>',
      ].join('\n'),
    ],
    [
      [
        '<figure data-docket-figure="1" data-decorative="false" itemscope itemtype="https://schema.org/ImageObject">',
        '<img src="/v1/orgs/org_1/images/image_1" alt="A &apos;quote&apos;" itemprop="contentUrl">',
        '</figure>',
      ].join('\n'),
    ],
  ])('rejects a figure that enters but does not satisfy the exact codec grammar', (html) => {
    expect(parseDocumentFigureHtml(html)).toBeNull();
  });

  it('extracts Docket figures and existing HTTPS Markdown images in document order', () => {
    const markdown = [
      'Before.',
      '',
      '![Legacy train](https://example.com/legacy.png "Morning service")',
      '',
      serializeDocumentFigure(completeFigure),
      '',
      'After.',
    ].join('\n');

    expect(extractDocumentFigures(markdown)).toEqual([
      {
        version: 1,
        src: 'https://example.com/legacy.png',
        alt: 'Legacy train',
        decorative: false,
        caption: 'Morning service',
      },
      completeFigure,
    ]);
  });

  it('does not treat an unsafe Markdown image or arbitrary HTML as a figure', () => {
    const markdown = [
      '![Unsafe](javascript:alert(1))',
      '',
      '<img src="https://example.com/not-owned.png" alt="Not owned">',
    ].join('\n');

    expect(extractDocumentFigures(markdown)).toEqual([]);
  });

  it('finds untitled Markdown images nested in lists and tables', () => {
    const markdown = [
      '- ![List image](https://example.com/list.png)',
      '',
      '| Preview | Notes |',
      '| --- | --- |',
      '| ![Table image](https://example.com/table.png) | Ready |',
    ].join('\n');

    expect(extractDocumentFigures(markdown)).toEqual([
      {
        version: 1,
        src: 'https://example.com/list.png',
        alt: 'List image',
        decorative: false,
      },
      {
        version: 1,
        src: 'https://example.com/table.png',
        alt: 'Table image',
        decorative: false,
      },
    ]);
  });

  it.each([
    ['morning-service.jpg', 'Morning service'],
    ['Q3_launch.final.png', 'Q3 launch final'],
    ['  skyline  .webp', 'Skyline'],
    ['.gif', 'Image'],
  ])('derives initial alt text from %s', (fileName, expected) => {
    expect(altTextFromFilename(fileName)).toBe(expected);
  });

  it('flattens visible and accessibility text without adding source URLs', () => {
    expect(documentFigurePlainText(completeFigure)).toBe(
      'A train arriving at a platform. The first train of the morning. Photo by Ada Rivera. CC BY 4.0.',
    );
    const { caption: _caption, ...uncaptionedFigure } = completeFigure;
    expect(
      documentFigurePlainText({
        ...uncaptionedFigure,
        alt: '',
        decorative: true,
      }),
    ).toBe('Photo by Ada Rivera. CC BY 4.0.');
  });

  it.each([
    ['/v1/orgs/org_1/images/image_1', 'image_1'],
    ['/v1/orgs/org_1/images/image_1?download=1', 'image_1'],
    ['https://example.com/v1/orgs/org_1/images/image_1', null],
    ['/v1/public/briefs/workspace/brief/images/image_1', null],
  ])('extracts an owned image id from %s', (src, expected) => {
    expect(documentImageIdFromSource(src)).toBe(expected);
  });
});
