import { Lexer, type Token } from 'marked';

/** The only Docket semantic-figure representation currently accepted in saved Markdown. */
export const DOCUMENT_FIGURE_VERSION = 1 as const;

/** The authored metadata that belongs to one use of a document image. */
export interface DocumentFigure {
  /** The serialized figure format version. */
  readonly version: typeof DOCUMENT_FIGURE_VERSION;
  /** The HTTPS or application-relative image source. */
  readonly src: string;
  /** The image alternative text. Decorative images always serialize this as an empty string. */
  readonly alt: string;
  /** Whether assistive technology should ignore the image. */
  readonly decorative: boolean;
  /** Optional visible phrasing content below the image. */
  readonly caption?: string;
  /** Optional creator or provider credit. */
  readonly creditText?: string;
  /** Optional HTTPS source page. */
  readonly sourceUrl?: string;
  /** Optional human-readable license name. */
  readonly licenseText?: string;
  /** Optional HTTPS license page. */
  readonly licenseUrl?: string;
}

type ImageToken = Token & {
  readonly type: 'image';
  readonly href: string;
  readonly text: string;
  readonly title?: string | null;
};

type HtmlToken = Token & {
  readonly type: 'html';
  readonly raw: string;
};

const FIGURE_PATTERN =
  /^<figure data-docket-figure="1" data-decorative="(true|false)" itemscope itemtype="https:\/\/schema\.org\/ImageObject">\n<img src="([^"]*)" alt="([^"]*)" itemprop="contentUrl">(?:\n<figcaption>([\s\S]*)<\/figcaption>)?\n<\/figure>$/;

const FIGCAPTION_PATTERN =
  /^(?:<span data-docket-caption itemprop="caption">([^<]*)<\/span>)?(?:<span data-docket-attribution>([\s\S]*)<\/span>)?$/;

const ATTRIBUTION_PATTERN =
  /^(?:<span data-docket-credit itemprop="creditText">([^<]*)<\/span>)?(?:<a data-docket-source href="([^"]*)">Source<\/a>)?(?:(?:<a data-docket-license href="([^"]*)"(?: data-docket-generated-label="(true)")? rel="license" itemprop="license">([^<]*)<\/a>)|(?:<span data-docket-license itemprop="license">([^<]*)<\/span>))?$/;

const HTML_ENTITIES: Readonly<Record<string, string>> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
};

/** Escape authored content before it enters an HTML text or attribute position. */
function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/** Decode only the five entities emitted by {@link escapeHtml}. */
function unescapeHtml(value: string): string {
  return value.replaceAll(/&(amp|lt|gt|quot|#39);/g, (entity) => HTML_ENTITIES[entity] ?? entity);
}

/** Return whether an image source is safe to place in an `img` element. */
function isSafeImageSource(value: string): boolean {
  if (value.startsWith('/') && !value.startsWith('//')) return true;
  return /^https:\/\/[^/\s?#]+(?:[/?#][^\s]*)?$/.test(value);
}

/** Return whether an attribution link uses the only accepted external scheme. */
function isSafeAttributionUrl(value: string): boolean {
  return /^https:\/\/[^/\s?#]+(?:[/?#][^\s]*)?$/.test(value);
}

/** Assert that one figure contains only URLs the renderer may expose. */
function assertSafeFigureUrls(figure: DocumentFigure): void {
  if (!isSafeImageSource(figure.src)) {
    throw new Error('Figure image URLs must use HTTPS or an application-relative path.');
  }
  if (
    (figure.sourceUrl !== undefined && !isSafeAttributionUrl(figure.sourceUrl)) ||
    (figure.licenseUrl !== undefined && !isSafeAttributionUrl(figure.licenseUrl))
  ) {
    throw new Error('Figure attribution URLs must use HTTPS.');
  }
}

/** Serialize the attribution portion of a semantic figure. */
function serializeAttribution(figure: DocumentFigure): string {
  const parts: string[] = [];
  if (figure.creditText) {
    parts.push(
      `<span data-docket-credit itemprop="creditText">${escapeHtml(figure.creditText)}</span>`,
    );
  }
  if (figure.sourceUrl) {
    parts.push(`<a data-docket-source href="${escapeHtml(figure.sourceUrl)}">Source</a>`);
  }
  if (figure.licenseUrl) {
    const licenseText = figure.licenseText?.trim() ?? '';
    const generatedLabel = licenseText ? '' : ' data-docket-generated-label="true"';
    parts.push(
      `<a data-docket-license href="${escapeHtml(figure.licenseUrl)}"${generatedLabel} rel="license" itemprop="license">${escapeHtml(licenseText ? (figure.licenseText ?? '') : 'License')}</a>`,
    );
  } else if (figure.licenseText) {
    parts.push(
      `<span data-docket-license itemprop="license">${escapeHtml(figure.licenseText)}</span>`,
    );
  }
  return parts.join('');
}

/** Serialize one version 1 figure into Docket's restricted semantic HTML block. */
export function serializeDocumentFigure(figure: DocumentFigure): string {
  assertSafeFigureUrls(figure);
  const alt = figure.decorative ? '' : figure.alt;
  const attribution = serializeAttribution(figure);
  const figcaption =
    figure.caption || attribution
      ? `\n<figcaption>${figure.caption ? `<span data-docket-caption itemprop="caption">${escapeHtml(figure.caption)}</span>` : ''}${attribution ? `<span data-docket-attribution>${attribution}</span>` : ''}</figcaption>`
      : '';

  return [
    `<figure data-docket-figure="1" data-decorative="${String(figure.decorative)}" itemscope itemtype="https://schema.org/ImageObject">`,
    `<img src="${escapeHtml(figure.src)}" alt="${escapeHtml(alt)}" itemprop="contentUrl">${figcaption}`,
    '</figure>',
  ].join('\n');
}

/** Parse the optional attribution portion of a codec-owned figure. */
function parseAttribution(value: string | undefined): Partial<DocumentFigure> | null {
  if (value === undefined) return {};
  const match = ATTRIBUTION_PATTERN.exec(value);
  if (!match) return null;
  const [
    ,
    creditText,
    sourceUrl,
    linkedLicenseUrl,
    generatedLicenseLabel,
    linkedLicenseText,
    textLicense,
  ] = match;
  return {
    ...(creditText ? { creditText: unescapeHtml(creditText) } : {}),
    ...(sourceUrl ? { sourceUrl: unescapeHtml(sourceUrl) } : {}),
    ...(linkedLicenseUrl ? { licenseUrl: unescapeHtml(linkedLicenseUrl) } : {}),
    ...(linkedLicenseText && !generatedLicenseLabel
      ? { licenseText: unescapeHtml(linkedLicenseText) }
      : {}),
    ...(textLicense ? { licenseText: unescapeHtml(textLicense) } : {}),
  };
}

/** Parse caption phrasing and attribution from a codec-owned figcaption. */
function parseFigcaption(value: string | undefined): Partial<DocumentFigure> | null {
  if (value === undefined) return {};
  const match = FIGCAPTION_PATTERN.exec(value);
  if (!match) return null;
  const attribution = parseAttribution(match[2]);
  if (attribution === null) return null;
  return {
    ...(match[1] ? { caption: unescapeHtml(match[1]) } : {}),
    ...attribution,
  };
}

/** Parse a possible codec-owned figure without accepting HTML outside the generated grammar. */
function parseCandidate(value: string): DocumentFigure | null {
  const figureMatch = FIGURE_PATTERN.exec(value);
  if (!figureMatch) return null;
  const [, decorativeValue, encodedSrc, encodedAlt, figcaptionHtml] = figureMatch;
  const figcaption = parseFigcaption(figcaptionHtml);
  if (figcaption === null) return null;

  const figure: DocumentFigure = {
    version: DOCUMENT_FIGURE_VERSION,
    src: unescapeHtml(encodedSrc ?? ''),
    alt: unescapeHtml(encodedAlt ?? ''),
    decorative: decorativeValue === 'true',
    ...figcaption,
  };
  try {
    assertSafeFigureUrls(figure);
    return serializeDocumentFigure(figure) === value ? figure : null;
  } catch {
    return null;
  }
}

/** Parse one exact Docket figure block, or return null for malformed and arbitrary HTML. */
export function parseDocumentFigureHtml(html: string): DocumentFigure | null {
  return parseCandidate(html.trim());
}

/** Narrow a Marked token to an image token. */
function isImageToken(token: Token): token is ImageToken {
  return token.type === 'image' && 'href' in token && 'text' in token;
}

/** Narrow a Marked token to a raw HTML token. */
function isHtmlToken(token: Token): token is HtmlToken {
  return token.type === 'html' && 'raw' in token;
}

/** Read token children without importing the package entrypoint back into this module. */
function tokenChildren(token: Token): readonly Token[] {
  const container = token as Token & {
    readonly tokens?: readonly Token[];
    readonly items?: readonly Token[];
    readonly rows?: readonly (readonly { readonly tokens?: readonly Token[] }[])[];
    readonly header?: readonly { readonly tokens?: readonly Token[] }[];
  };
  const children: Token[] = [...(container.tokens ?? []), ...(container.items ?? [])];
  for (const cell of container.header ?? []) children.push(...(cell.tokens ?? []));
  for (const row of container.rows ?? []) {
    for (const cell of row) children.push(...(cell.tokens ?? []));
  }
  return children;
}

/** Append every supported figure reachable from one Marked token in document order. */
function collectFigures(token: Token, figures: DocumentFigure[]): void {
  if (isHtmlToken(token)) {
    const figure = parseDocumentFigureHtml(token.raw);
    if (figure) figures.push(figure);
    return;
  }
  if (isImageToken(token)) {
    if (isSafeImageSource(token.href)) {
      figures.push({
        version: DOCUMENT_FIGURE_VERSION,
        src: token.href,
        alt: token.text,
        decorative: token.text.length === 0,
        ...(token.title ? { caption: token.title } : {}),
      });
    }
    return;
  }
  for (const child of tokenChildren(token)) collectFigures(child, figures);
}

/** Extract Docket figures and compatible Markdown images from a Markdown document in source order. */
export function extractDocumentFigures(markdown: string): readonly DocumentFigure[] {
  const figures: DocumentFigure[] = [];
  for (const token of new Lexer().lex(markdown)) collectFigures(token, figures);
  return figures;
}

/** Derive a readable initial alternative text value from an uploaded file's original name. */
export function altTextFromFilename(fileName: string): string {
  const leafName = fileName.split(/[\\/]/).at(-1) ?? fileName;
  const withoutExtension = leafName.replace(/\.[^.]*$/, '');
  const words = withoutExtension
    .replaceAll(/[._-]+/g, ' ')
    .replaceAll(/\s+/g, ' ')
    .trim();
  return words ? `${words.charAt(0).toUpperCase()}${words.slice(1)}` : 'Image';
}

/** Flatten one figure into the text that search, excerpts, and reduced-fidelity exports preserve. */
export function documentFigurePlainText(figure: DocumentFigure): string {
  const parts = [
    figure.decorative ? undefined : figure.alt,
    figure.caption,
    figure.creditText,
    figure.licenseText,
  ].filter((part): part is string => Boolean(part?.trim()));
  return parts
    .map((part) => {
      const trimmed = part.trim();
      return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
    })
    .join(' ');
}

/** Read the blob id from a private Docket document-image source. */
export function documentImageIdFromSource(src: string): string | null {
  return /^\/v1\/orgs\/[^/?#]+\/images\/([^/?#]+)(?:[?#].*)?$/.exec(src)?.[1] ?? null;
}
