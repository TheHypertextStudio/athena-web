/**
 * `lib/clipboard/object-clipboard` — what a task or a project *is* on the clipboard.
 *
 * @remarks
 * Copying a row used to hand over whatever text happened to be in the DOM: a title with no way back
 * to the thing it names, and often the status chip and the estimate glued onto the end of it. What a
 * person means by copying a task is "give me this task so I can refer to it somewhere else", and the
 * only form that survives leaving the app is a **linked title**.
 *
 * So one object becomes `[Fix the login redirect](https://…/tasks/01JY…)`, and several become a
 * list. Both flavors are produced from the same data: Markdown for plain-text targets, an anchor or
 * list for rich ones, so pasting into a doc gives real links and pasting into an editor gives real
 * Markdown.
 *
 * Deliberately no status, assignee, or dates. An {@link ObjectRef} carries ids, not labels — a copy
 * that included them would have to fetch, which turns an instant gesture into a request that can be
 * slow, fail, or be offline. The link is the durable part; everything else is a snapshot that is
 * wrong by the time it is read.
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
 * Only the characters that would end the link text or start a new construct where it sits. A task
 * really can be called `Fix [Button] rendering`, and without this the copied Markdown would parse
 * as a broken nested link — the title has to survive a round trip through a Markdown parser as the
 * same string it started as.
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
 * Parentheses and whitespace are what end a destination. Docket's own URLs contain neither, but a
 * destination is still built defensively because the ids in it are opaque.
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
 * A single object is deliberately *not* wrapped in a list. Copying one task and pasting it
 * mid-sentence should read as a link in that sentence, not as a one-item bullet the writer then has
 * to unpick.
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
