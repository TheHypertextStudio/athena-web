/**
 * `lib/clipboard/object-clipboard` — what a task or a project *is* on the clipboard.
 *
 * @remarks
 * Copying a task means "give me this task so I can refer to it somewhere else", and the form that
 * survives leaving the app is a **linked title**. One object becomes
 * `[Fix the login redirect](https://…/tasks/01JY…)`; several become a list. Both flavors come from
 * the same data — Markdown for plain-text targets, an anchor or list for rich ones — so a doc gets
 * real links and an editor gets real Markdown.
 *
 * The payload carries the title and the link. An {@link ObjectRef} holds ids, so status, assignee
 * and dates would each cost a fetch, and each is a snapshot that goes stale the moment it lands. The
 * link stays true.
 *
 * Pure and React-free, so it is unit-testable and callable from a `copy` listener.
 *
 * @see {@link ./write} for the write itself.
 * @see {@link ../actions/object} for {@link objectHref}, the one route derivation.
 */
import { type ObjectRef, objectHref } from '../actions/object';
import { escapeHtml, type ClipboardPayload } from './write';

/**
 * Escape a title for use as Markdown link text.
 *
 * @remarks
 * Covers the characters that would end the link text or start a construct where it sits, so a task
 * called `Fix [Button] rendering` survives a round trip through a Markdown parser as that string.
 *
 * @param value - The raw title.
 * @returns The title, safe to place between `[` and `]`.
 */
function escapeMarkdownLinkText(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('[', '\\[').replaceAll(']', '\\]');
}

/**
 * Escape a URL for use as a Markdown link destination.
 *
 * @remarks
 * Parentheses and whitespace end a destination. The ids in a Docket URL are opaque, so the
 * destination is escaped on the way in.
 *
 * @param value - The absolute URL.
 * @returns The URL, safe to place between `(` and `)`.
 */
function escapeMarkdownDestination(value: string): string {
  return value.replaceAll('(', '%28').replaceAll(')', '%29').replaceAll(' ', '%20');
}

/** One object reduced to the two things a clipboard entry needs. */
interface LinkedObject {
  /** The object's title, as displayed. */
  readonly title: string;
  /** Its absolute URL, or `null` when the object has no detail page. */
  readonly url: string | null;
}

/** Resolve every object to a title and an absolute URL. */
function linkedObjects(objects: readonly ObjectRef[], origin: string): readonly LinkedObject[] {
  return objects.map((object) => {
    const path = objectHref(object);
    return { title: object.title, url: path === null ? null : `${origin}${path}` };
  });
}

/** One object as Markdown: a link, or bare text when it has nowhere to point. */
function toMarkdown(entry: LinkedObject): string {
  const text = escapeMarkdownLinkText(entry.title);
  return entry.url === null ? text : `[${text}](${escapeMarkdownDestination(entry.url)})`;
}

/** One object as HTML: an anchor, or escaped text when it has nowhere to point. */
function toHtml(entry: LinkedObject): string {
  const text = escapeHtml(entry.title);
  return entry.url === null ? text : `<a href="${escapeHtml(entry.url)}">${text}</a>`;
}

/**
 * Build both clipboard flavors for a set of core objects.
 *
 * @remarks
 * A single object comes back as a bare link, so pasting one task mid-sentence reads as a link in
 * that sentence.
 *
 * @param objects - The objects to copy, in the order the user sees them.
 * @param origin - The absolute origin to resolve paths against, e.g. `window.location.origin`.
 * @returns The Markdown and HTML flavors; both empty when there is nothing to copy.
 *
 * @example
 * ```ts
 * const payload = objectsToClipboard(selected, window.location.origin);
 * // payload.text === '- [Fix the login redirect](https://…/tasks/01JY…)\n- [Ship billing](…)'
 * ```
 */
export function objectsToClipboard(
  objects: readonly ObjectRef[],
  origin: string,
): ClipboardPayload {
  const entries = linkedObjects(objects, origin);
  if (entries.length === 0) return { text: '', html: '' };

  const single = entries[0];
  if (entries.length === 1 && single !== undefined) {
    return { text: toMarkdown(single), html: toHtml(single) };
  }

  return {
    text: entries.map((entry) => `- ${toMarkdown(entry)}`).join('\n'),
    html: `<ul>${entries.map((entry) => `<li>${toHtml(entry)}</li>`).join('')}</ul>`,
  };
}
