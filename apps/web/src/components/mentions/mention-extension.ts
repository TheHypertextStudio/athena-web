'use client';

/**
 * The ProseMirror node a mention is, and the Markdown it round-trips through.
 *
 * @remarks
 * An `atom` inline node rather than a decorated link mark, because atom semantics are exactly the
 * editing behavior a chip should have: one Backspace deletes the whole thing, arrow keys step over
 * it as a unit instead of wandering through its letters, and arrowing onto it selects the node —
 * which is what gives the hovercard a keyboard path.
 *
 * Markdown is emitted as an ordinary link carrying the machine ref in the title slot, which is
 * what lets any renderer we do not control drop the title and still show a normal working link —
 * so digests, exports, and agent prompts stay correct.
 *
 * On the way back in, the mention claims its own lexer token rather than contending for `link`.
 * Sharing the `link` token made ordinary links parse to nothing; see the tokenizer below.
 */
import { Node, mergeAttributes } from '@tiptap/core';
import type { MarkdownParseResult, MarkdownToken } from '@tiptap/core';
import { formatMentionLink, parseMentionMarker, type MentionRef } from '@docket/types';

/** Attributes stored on a mention node. */
export interface MentionAttributes {
  /** `entity` or `external`. */
  readonly kind: string;
  /** Entity kind for the entity arm; empty for the external arm. */
  readonly entityKind: string;
  /** Entity id for the entity arm; empty for the external arm. */
  readonly entityId: string;
  /** Where the chip navigates. */
  readonly href: string;
  /** The label as authored, which is what renders until hydration supplies a fresher title. */
  readonly label: string;
}

/**
 * The token this extension's tokenizer produces.
 *
 * @remarks
 * Carries the resolved {@link MentionRef} rather than the raw strings, so the parse step reads a
 * decision the tokenizer already made.
 */
export interface MentionMarkdownToken {
  readonly type: typeof MENTION_NODE;
  readonly raw: string;
  readonly label: string;
  readonly href: string;
  readonly ref: MentionRef;
}

/** ProseMirror hands node attributes through as an index signature; read them explicitly. */
type NodeAttributeBag = Readonly<Record<string, unknown>>;

/** Read one attribute as a string, defaulting to empty rather than to `undefined`. */
function readString(bag: NodeAttributeBag, key: string): string {
  const value = bag[key];
  return typeof value === 'string' ? value : '';
}

/**
 * Read a node's attribute bag into the typed shape this module works in.
 *
 * @param bag - `node.attrs`, which ProseMirror types only as an index signature.
 * @returns The attributes, with anything missing or mistyped read as an empty string.
 */
export function readMentionAttributes(bag: NodeAttributeBag): MentionAttributes {
  return {
    kind: readString(bag, 'kind'),
    entityKind: readString(bag, 'entityKind'),
    entityId: readString(bag, 'entityId'),
    href: readString(bag, 'href'),
    label: readString(bag, 'label'),
  };
}

/**
 * Rebuild a ref from stored node attributes.
 *
 * @remarks
 * Re-parses the entity kind rather than asserting it, so an attribute from an older schema
 * degrades to an external reference instead of a ref whose kind is unchecked.
 */
export function refFromAttributes(attrs: MentionAttributes): MentionRef {
  if (attrs.kind !== 'entity') return { kind: 'external', url: attrs.href };
  const parsed = parseMentionMarker(attrs.href, `docket:v1:${attrs.entityKind}:${attrs.entityId}`);
  return parsed ?? { kind: 'external', url: attrs.href };
}

/** Build node attributes from a ref and its display text. */
export function attributesFromRef(ref: MentionRef, label: string, href: string): MentionAttributes {
  return ref.kind === 'entity'
    ? { kind: 'entity', entityKind: ref.entityKind, entityId: ref.entityId, href, label }
    : { kind: 'external', entityKind: '', entityId: '', href, label };
}

/** The node name, shared by the schema, the node view, and the markdown handler. */
export const MENTION_NODE = 'mention';

/**
 * A Markdown link whose title slot carries a Docket marker, anchored to the start of the input.
 *
 * @remarks
 * Deliberately narrow. The label allows escaped characters so `[Plan \[draft\]]` survives; the
 * href stops at whitespace, since the serializer percent-encodes anything that would otherwise
 * end the target early. Anything that does not match exactly is left for marked's own link rule.
 */
const MENTION_LINK_PATTERN = /^\[((?:\\.|[^\]\\])*)\]\(\s*([^\s)]+)\s+"(docket:v1:[^"]*)"\s*\)/;

/** Reverse the label escaping the serializer applies. */
function unescapeLabel(label: string): string {
  return label.replace(/\\([[\]\\])/g, '$1');
}

/** Whether a token is one this extension produced. */
function isMentionToken(token: MarkdownToken): token is MarkdownToken & MentionMarkdownToken {
  return token.type === MENTION_NODE && 'ref' in token;
}

/**
 * The mention node extension.
 *
 * @remarks
 * Created by a factory rather than exported as a constant so the caller supplies its node view,
 * which needs React context the extension module has no business importing.
 *
 * @param addNodeView - Supplies the React renderer for the node.
 * @returns The configured extension.
 */
export function createMentionExtension(addNodeView: () => unknown) {
  return Node.create({
    name: MENTION_NODE,
    group: 'inline',
    inline: true,
    atom: true,
    selectable: true,
    draggable: false,
    // Above @tiptap/extension-link's 1000, so this extension's tokenizer is registered with marked
    // before the built-in link rule gets a chance at the same text.
    priority: 1100,

    addAttributes() {
      return {
        kind: { default: 'external' },
        entityKind: { default: '' },
        entityId: { default: '' },
        href: { default: '' },
        label: { default: '' },
      };
    },

    parseHTML() {
      return [{ tag: 'a[data-mention-kind]' }];
    },

    renderHTML({ HTMLAttributes, node }) {
      const attrs = readMentionAttributes(node.attrs);
      return [
        'a',
        mergeAttributes(HTMLAttributes, {
          'data-mention-kind': attrs.kind,
          href: attrs.href,
        }),
        attrs.label,
      ];
    },

    addNodeView: addNodeView as never,

    /**
     * A token of our own, claimed before marked's link rule sees the text.
     *
     * @remarks
     * Registering a handler under the `link` token and declining unmarked ones does not work:
     * `MarkdownManager` documents a declining handler as falling through, but registering any
     * handler for `link` diverts the token off the built-in path and an ordinary link then parses
     * to nothing, losing its text from the document.
     */
    markdownTokenizer: {
      name: MENTION_NODE,
      level: 'inline',
      start: (src: string) => src.indexOf('['),
      tokenize: (src: string): MentionMarkdownToken | undefined => {
        const match = MENTION_LINK_PATTERN.exec(src);
        if (!match) return undefined;
        const [raw, label = '', href = '', title = ''] = match;
        // Resolve here so the parse step has no failure branch, and so a marker on a
        // `javascript:` href falls through to marked's own rules.
        const ref = parseMentionMarker(href, title);
        if (ref === undefined) return undefined;
        return { type: MENTION_NODE, raw, label: unescapeLabel(label), href, ref };
      },
    },

    parseMarkdown(token: MarkdownToken): MarkdownParseResult {
      if (!isMentionToken(token)) return [];
      return {
        type: MENTION_NODE,
        attrs: attributesFromRef(token.ref, token.label, token.href),
      };
    },

    renderMarkdown(node: { attrs?: NodeAttributeBag | undefined }) {
      const attrs = readMentionAttributes(node.attrs ?? {});
      return formatMentionLink(attrs.label, attrs.href, refFromAttributes(attrs));
    },
  });
}
