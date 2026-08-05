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
 * The reasoning is recorded on the tokenizer below, and it is not a preference: sharing the `link`
 * token made ordinary links parse to nothing at all.
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

/** Rebuild a ref from stored node attributes. */
export function refFromAttributes(attrs: MentionAttributes): MentionRef {
  return attrs.kind === 'entity'
    ? { kind: 'entity', entityKind: attrs.entityKind as never, entityId: attrs.entityId }
    : { kind: 'external', url: attrs.href };
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
      return [
        'a',
        mergeAttributes(HTMLAttributes, {
          'data-mention-kind': String(node.attrs['kind']),
          href: String(node.attrs['href']),
        }),
        String(node.attrs['label']),
      ];
    },

    addNodeView: addNodeView as never,

    /**
     * A token of our own, claimed before marked's link rule ever sees the text.
     *
     * @remarks
     * The obvious alternative — registering a handler under the `link` token and declining the
     * ones without a marker — does not work. `MarkdownManager` documents a declining handler as
     * falling through to the next one, but in practice registering *any* handler for `link`
     * diverts the token off the built-in path, and an ordinary link then parses to nothing: its
     * text disappears from the document entirely. Owning a distinct token keeps ordinary links on
     * the untouched code path, which is the only way to be sure they still work.
     */
    markdownTokenizer: {
      name: MENTION_NODE,
      level: 'inline',
      start: (src: string) => src.indexOf('['),
      tokenize: (src: string) => {
        const match = MENTION_LINK_PATTERN.exec(src);
        if (!match) return undefined;
        const [raw, label = '', href = '', title = ''] = match;
        // Validate before claiming: a marker on a `javascript:` href must fall through to
        // marked's own rules rather than become a navigable chip.
        if (parseMentionMarker(href, title) === undefined) return undefined;
        return { type: MENTION_NODE, raw, label, href, title };
      },
    },

    parseMarkdown(token: MarkdownToken): MarkdownParseResult {
      const claimed = token as unknown as { label: string; href: string; title: string };
      const ref = parseMentionMarker(claimed.href, claimed.title);
      if (ref === undefined) return undefined as unknown as MarkdownParseResult;
      return {
        type: MENTION_NODE,
        attrs: attributesFromRef(ref, unescapeLabel(claimed.label), claimed.href),
      };
    },

    renderMarkdown(node: { attrs?: Record<string, unknown> }) {
      const attrs = (node.attrs ?? {}) as unknown as MentionAttributes;
      return formatMentionLink(attrs.label, attrs.href, refFromAttributes(attrs));
    },
  });
}
