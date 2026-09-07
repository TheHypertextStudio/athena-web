'use client';

import { mergeAttributes, Node, type JSONContent, type NodeViewRenderer } from '@tiptap/core';
import type { MarkdownParseResult, MarkdownToken } from '@tiptap/core';

import {
  altTextFromFilename,
  parseDocumentFigureHtml,
  serializeDocumentFigure,
  type DocumentFigure,
} from '@docket/markdown-tree';

/** The ProseMirror node name used by the editor, upload controller, and toolbar. */
export const DOCUMENT_FIGURE_NODE = 'documentFigure';

/** Upload state stored only in the live editor document. */
export type DocumentFigureStatus = 'ready' | 'uploading' | 'failed';

/** Attributes carried by one figure node. Its caption is the node's plain-text content. */
export interface DocumentFigureAttributes {
  readonly src: string;
  readonly alt: string;
  readonly decorative: boolean;
  readonly caption: string;
  readonly creditText: string;
  readonly sourceUrl: string;
  readonly licenseText: string;
  readonly licenseUrl: string;
  readonly status: DocumentFigureStatus;
  readonly uploadId: string;
  readonly previewSrc: string;
  readonly fileName: string;
}

type AttributeBag = Readonly<Record<string, unknown>>;
type FigureMarkdownToken = MarkdownToken & { readonly figure?: DocumentFigure };

/** Read one string attribute without trusting ProseMirror's index signature. */
function stringAttribute(attrs: AttributeBag, key: keyof DocumentFigureAttributes): string {
  const value = attrs[key];
  return typeof value === 'string' ? value : '';
}

/** Convert ProseMirror's attribute bag into the node view's typed contract. */
export function readDocumentFigureAttributes(attrs: AttributeBag): DocumentFigureAttributes {
  const status = attrs['status'];
  return {
    src: stringAttribute(attrs, 'src'),
    alt: stringAttribute(attrs, 'alt'),
    decorative: attrs['decorative'] === true,
    caption: stringAttribute(attrs, 'caption'),
    creditText: stringAttribute(attrs, 'creditText'),
    sourceUrl: stringAttribute(attrs, 'sourceUrl'),
    licenseText: stringAttribute(attrs, 'licenseText'),
    licenseUrl: stringAttribute(attrs, 'licenseUrl'),
    status: status === 'uploading' || status === 'failed' ? status : 'ready',
    uploadId: stringAttribute(attrs, 'uploadId'),
    previewSrc: stringAttribute(attrs, 'previewSrc'),
    fileName: stringAttribute(attrs, 'fileName'),
  };
}

/** Convert one codec figure into ProseMirror attributes. */
function attributesFromFigure(figure: DocumentFigure): DocumentFigureAttributes {
  return {
    src: figure.src,
    alt: figure.alt,
    decorative: figure.decorative,
    caption: figure.caption ?? '',
    creditText: figure.creditText ?? '',
    sourceUrl: figure.sourceUrl ?? '',
    licenseText: figure.licenseText ?? '',
    licenseUrl: figure.licenseUrl ?? '',
    status: 'ready',
    uploadId: '',
    previewSrc: '',
    fileName: '',
  };
}

/** Build the codec value represented by a ready or replacing editor node. */
function figureFromNode(node: JSONContent): DocumentFigure | null {
  const attrs = readDocumentFigureAttributes(node.attrs ?? {});
  if (!attrs.src) return null;
  return {
    version: 1,
    src: attrs.src,
    alt: attrs.decorative ? '' : attrs.alt,
    decorative: attrs.decorative,
    ...(attrs.caption.trim() ? { caption: attrs.caption.trim() } : {}),
    ...(attrs.creditText ? { creditText: attrs.creditText } : {}),
    ...(attrs.sourceUrl ? { sourceUrl: attrs.sourceUrl } : {}),
    ...(attrs.licenseText ? { licenseText: attrs.licenseText } : {}),
    ...(attrs.licenseUrl ? { licenseUrl: attrs.licenseUrl } : {}),
  };
}

/** The exact restricted figure at the start of a Markdown block, if one is complete. */
function tokenizeFigure(src: string): MarkdownToken | undefined {
  const end = src.indexOf('</figure>');
  if (end < 0) return undefined;
  const candidate = src.slice(0, end + '</figure>'.length);
  const figure = parseDocumentFigureHtml(candidate);
  const followingNewline = src[candidate.length] === '\n' ? '\n' : '';
  if (!figure) {
    return {
      type: 'paragraph',
      raw: `${candidate}${followingNewline}`,
      text: candidate,
      tokens: [{ type: 'text', raw: candidate, text: candidate }],
    };
  }
  return { type: 'image', raw: `${candidate}${followingNewline}`, figure };
}

/** Options supplied by the editor host to the figure node. */
export interface DocumentFigureExtensionOptions {
  /** The React node view renderer. */
  readonly nodeView?: NodeViewRenderer;
}

/** Create the semantic figure node and its Markdown codec hooks. */
export function createDocumentFigureExtension(options: DocumentFigureExtensionOptions = {}) {
  return Node.create({
    name: DOCUMENT_FIGURE_NODE,
    group: 'block',
    atom: true,
    selectable: true,
    draggable: true,
    defining: true,
    markdownTokenName: 'image',

    addAttributes() {
      return {
        src: { default: '' },
        alt: { default: '' },
        decorative: { default: false },
        caption: { default: '' },
        creditText: { default: '' },
        sourceUrl: { default: '' },
        licenseText: { default: '' },
        licenseUrl: { default: '' },
        status: { default: 'ready', rendered: false },
        uploadId: { default: '', rendered: false },
        previewSrc: { default: '', rendered: false },
        fileName: { default: '', rendered: false },
      };
    },

    renderHTML({ node, HTMLAttributes }) {
      const attrs = readDocumentFigureAttributes(node.attrs);
      return [
        'figure',
        mergeAttributes(HTMLAttributes, {
          'data-docket-figure': '1',
          'data-decorative': String(attrs.decorative),
          itemscope: '',
          itemtype: 'https://schema.org/ImageObject',
        }),
        [
          'img',
          {
            src: attrs.previewSrc || attrs.src,
            alt: attrs.decorative ? '' : attrs.alt,
            itemprop: 'contentUrl',
          },
        ],
        ...(attrs.caption ? [['figcaption', {}, attrs.caption]] : []),
      ];
    },

    addNodeView() {
      return options.nodeView ?? null;
    },

    markdownTokenizer: {
      name: DOCUMENT_FIGURE_NODE,
      level: 'block',
      start: (src: string) => src.indexOf('<figure data-docket-figure="1"'),
      tokenize: (src: string) => tokenizeFigure(src),
    },

    parseMarkdown(token: FigureMarkdownToken, helpers): MarkdownParseResult {
      const figure =
        token.figure ??
        ('href' in token && typeof token['href'] === 'string'
          ? {
              version: 1 as const,
              src: token['href'],
              alt: typeof token.text === 'string' ? token.text : '',
              decorative: typeof token.text !== 'string' || token.text === '',
              ...(typeof token['title'] === 'string' && token['title']
                ? { caption: token['title'] }
                : {}),
            }
          : null);
      if (!figure) return [];
      try {
        serializeDocumentFigure(figure);
      } catch {
        return [];
      }
      return helpers.createNode(DOCUMENT_FIGURE_NODE, attributesFromFigure(figure));
    },

    renderMarkdown(node: JSONContent) {
      const figure = figureFromNode(node);
      return figure ? serializeDocumentFigure(figure) : '';
    },
  });
}

/** Build a pending node for one newly selected image file. */
export function pendingDocumentFigure(
  file: File,
  uploadId: string,
  previewSrc: string,
): JSONContent {
  return {
    type: DOCUMENT_FIGURE_NODE,
    attrs: {
      ...attributesFromFigure({
        version: 1,
        src: '',
        alt: altTextFromFilename(file.name),
        decorative: false,
      }),
      fileName: file.name,
      previewSrc,
      status: 'uploading',
      uploadId,
    },
  };
}
