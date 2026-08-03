/**
 * The `@mention` node — a first-class reference to a Docket object inside any editor.
 *
 * @remarks
 * A mention is **not** the text of a title. It stores the object's kind and id, and the label is
 * only a fallback for rendering before the live title is known. That distinction is the whole
 * requirement: renaming a project must change every mention of it, and a stored title would
 * quietly go stale the moment someone renamed anything.
 *
 * Persistence rides on `@tiptap/markdown`'s inline shortcode spec, so a mention round-trips
 * through the Markdown the API stores as:
 *
 * ```
 * [mention kind="project" id="01J…" label="Launch Docket"]
 * ```
 *
 * The id is in the document, which is what makes the reference resolvable; the label travels
 * with it so a document read outside the app (a plain-text export, a diff) still says something
 * human. On the way back in, the label is treated as a *fallback* — {@link resolveMentionLabel}
 * overrides it with the object's current title whenever the app knows one.
 *
 * The node is an inline atom: the caret steps over it whole, Backspace removes it whole, and it
 * can never be half-edited into a broken reference.
 */
import { createInlineMarkdownSpec, mergeAttributes, Node } from '@tiptap/react';

import { mentionKeyOf } from './mention-key';
import { readMentionLabel, subscribeMentionLabels } from './mention-labels';

/** The object kinds a mention may point at. */
export const MENTION_KINDS = [
  'task',
  'project',
  'initiative',
  'program',
  'cycle',
  'person',
] as const;

/** One of {@link MENTION_KINDS}. */
export type MentionKind = (typeof MENTION_KINDS)[number];

/** The stored shape of one mention. */
export interface MentionAttributes {
  /** Which kind of object is referenced. */
  readonly kind: MentionKind;
  /** The object's id — the part that makes this a reference rather than text. */
  readonly id: string;
  /** The title as it stood when the mention was made; a fallback, never the source of truth. */
  readonly label: string;
}

/** True when `value` names a kind a mention may point at. */
export function isMentionKind(value: unknown): value is MentionKind {
  return typeof value === 'string' && (MENTION_KINDS as readonly string[]).includes(value);
}

/**
 * The in-app route for a mentioned object.
 *
 * @param kind - The object kind.
 * @param id - The object id.
 * @param organizationId - The workspace the reader is in.
 * @returns An app-relative href.
 */
export function mentionHref(kind: MentionKind, id: string, organizationId: string): string {
  const base = `/orgs/${organizationId}`;
  switch (kind) {
    case 'task':
      return `${base}/tasks/${id}`;
    case 'project':
      return `${base}/projects/${id}`;
    case 'initiative':
      return `${base}/initiatives/${id}`;
    case 'program':
      return `${base}/programs/${id}`;
    case 'cycle':
      return `${base}/cycles/${id}`;
    case 'person':
      return `${base}/settings/members`;
  }
}

/**
 * The Tiptap node.
 *
 * @remarks
 * Rendered as a real `<a>` so a mention is clickable, focusable, copyable, and openable in a new
 * tab for free — the same reason a list row's title is an anchor rather than an `onClick`. The
 * `data-mention-*` attributes are what the resolver reads to swap in the live title, and what
 * `apps/web/tests/editor/` asserts against.
 */
export const Mention = Node.create({
  name: 'mention',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      kind: {
        default: 'task',
        parseHTML: (element) => element.getAttribute('data-mention-kind'),
        renderHTML: (attributes) => ({ 'data-mention-kind': String(attributes['kind']) }),
      },
      id: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-mention-id'),
        renderHTML: (attributes) => ({ 'data-mention-id': String(attributes['id']) }),
      },
      label: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-mention-label'),
        renderHTML: (attributes) => ({ 'data-mention-label': String(attributes['label']) }),
      },
      href: {
        default: null,
        parseHTML: (element) => element.getAttribute('href'),
        renderHTML: (attributes) =>
          attributes['href'] ? { href: String(attributes['href']) } : {},
      },
    };
  },

  parseHTML() {
    return [{ tag: 'a[data-mention-id]' }];
  },

  renderHTML({ HTMLAttributes, node }) {
    const label = typeof node.attrs['label'] === 'string' ? node.attrs['label'] : '';
    return [
      'a',
      mergeAttributes(HTMLAttributes, {
        'data-mention': '',
        class:
          'bg-secondary-container text-on-secondary-container rounded-md px-1 no-underline! whitespace-nowrap',
      }),
      `@${label}`,
    ];
  },

  renderText({ node }) {
    return `@${typeof node.attrs['label'] === 'string' ? node.attrs['label'] : ''}`;
  },

  /**
   * Show the object's *current* title, not the one captured when the mention was made.
   *
   * @remarks
   * This is the half of the requirement a stored label cannot satisfy: rename a project and
   * every mention of it must follow. The node view subscribes to the title registry and
   * re-renders in place; when the registry knows nothing about this object (offline, or the
   * workspace lists have not loaded yet) it falls back to the stored label, so the chip always
   * says something human rather than an id.
   */
  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement('a');
      const kind = String(node.attrs['kind']);
      const id = String(node.attrs['id']);
      const fallback = String(node.attrs['label']);
      const key = mentionKeyOf(kind, id);
      dom.setAttribute('data-mention', '');
      dom.setAttribute('data-mention-kind', kind);
      dom.setAttribute('data-mention-id', id);
      dom.setAttribute('data-mention-label', fallback);
      if (typeof node.attrs['href'] === 'string' && node.attrs['href'] !== '') {
        dom.setAttribute('href', node.attrs['href']);
      }
      dom.className =
        'bg-secondary-container text-on-secondary-container rounded-md px-1 no-underline! whitespace-nowrap';
      const paint = (): void => {
        dom.textContent = `@${readMentionLabel(key) ?? fallback}`;
      };
      paint();
      const unsubscribe = subscribeMentionLabels(paint);
      return { dom, destroy: unsubscribe, ignoreMutation: () => true };
    };
  },

  ...createInlineMarkdownSpec({
    nodeName: 'mention',
    selfClosing: true,
    allowedAttributes: ['kind', 'id', 'label'],
  }),
});
