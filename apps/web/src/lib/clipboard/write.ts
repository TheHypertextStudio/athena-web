/**
 * `lib/clipboard/write` — the one place Docket puts formatted content on the clipboard.
 *
 * @remarks
 * Everything the app copied before this module went out through `navigator.clipboard.writeText`,
 * which can only carry one flavor. That is why copying a task body produced a wall of unformatted
 * prose the moment it was pasted anywhere: the *text* was all the clipboard was ever given.
 *
 * The web clipboard is a multi-flavor surface. A single {@link ClipboardItem} can carry `text/html`
 * and `text/plain` at once, and the *paste target* — not the copier — decides which one it wants.
 * Google Docs, Notion, Slack, and Linear take the HTML and render real headings and lists; a code
 * editor, a terminal, or a Markdown file takes the plain text. Writing both is therefore the whole
 * trick behind "copy preserves formatting": there is no mode to pick and no second menu item,
 * because both answers are already on the clipboard.
 *
 * Docket's plain-text flavor is deliberately **Markdown**, not flattened prose. Bodies are stored as
 * Markdown, so the plain flavor is the source itself — which is what makes a Docket → editor → Docket
 * round trip lossless.
 *
 * ## Two platform constraints this module exists to encapsulate
 *
 * **Safari needs the promises synchronously.** WebKit only honors a clipboard write that is still
 * inside the user gesture that triggered it. Awaiting anything *before* constructing the
 * `ClipboardItem` ends the gesture and the write is rejected. So the item is always built from
 * already-resolved promises in the same tick the caller was entered, and only the `write()` call is
 * awaited.
 *
 * **Failure must never escape.** Every caller is an event handler — a menu item, a `copy` listener —
 * where a thrown clipboard error would break the surrounding interaction over something the user can
 * simply retry. So the API reports success as a boolean and callers render feedback from it.
 *
 * @see {@link ./object-clipboard} for the Markdown/HTML pair produced for core objects.
 * @see {@link ../use-copy-feedback} for the acknowledgement callers render from the result.
 */

/** The two flavors every Docket copy writes. */
export interface ClipboardPayload {
  /**
   * The rich flavor, taken by editors that understand structure.
   *
   * @remarks
   * A fragment, not a document — no `<html>` or `<body>` wrapper. Receiving apps splice it into
   * their own document, and a wrapper is at best ignored and at worst treated as literal content.
   *
   * An empty string means *this content has no rich form* (a code fence, a bare identifier), and
   * the write degrades to plain text only. It must never be written as an empty `text/html` flavor:
   * a rich target that finds one prefers it and pastes nothing at all.
   */
  readonly html: string;
  /**
   * The plain flavor, taken by everything else. Always Markdown for Docket content.
   */
  readonly text: string;
}

/**
 * Whether this device can be written to at all.
 *
 * @remarks
 * Callers use this to *hide* a copy affordance rather than render one that can never work — the
 * precedent set by `task.copyLink`, which is absent rather than disabled where there is no
 * clipboard. There is nothing useful to say in a disabled reason about a missing platform API.
 *
 * @returns `true` when the async clipboard API is present.
 */
export function canWriteClipboard(): boolean {
  return typeof asyncClipboard()?.writeText === 'function';
}

/**
 * The async clipboard, when this context actually has one.
 *
 * @remarks
 * `navigator.clipboard` is typed as always present and genuinely is not: it is absent in a
 * non-secure context, absent during server rendering, and absent in some embedded webviews. The
 * cast is what lets the honest runtime check survive a type system that believes otherwise —
 * without it, `typeof navigator.clipboard.writeText` throws on exactly the devices this guard
 * exists for.
 */
function asyncClipboard(): Clipboard | undefined {
  if (typeof navigator === 'undefined') return undefined;
  return (navigator as { clipboard?: Clipboard }).clipboard;
}

/**
 * Whether this device can carry more than one flavor.
 *
 * @remarks
 * Exported for tests and for callers that want to explain a degraded copy. A `false` here is not a
 * failure — {@link writeClipboard} still writes the Markdown flavor, which is the more useful of
 * the two to lose last.
 *
 * @returns `true` when `ClipboardItem` and `clipboard.write` both exist.
 */
export function canWriteRichClipboard(): boolean {
  return typeof ClipboardItem === 'function' && typeof asyncClipboard()?.write === 'function';
}

/**
 * Put a formatted payload on the system clipboard.
 *
 * @remarks
 * Degrades in one step: where the multi-flavor API is missing or refuses the write, the Markdown
 * flavor still lands via `writeText`. A caller therefore never has to branch on platform support —
 * it only has to handle "it worked" or "it did not".
 *
 * Must be called synchronously from a user gesture; see the module remarks.
 *
 * @param payload - The rich and plain flavors to write.
 * @returns `true` when something reached the clipboard, `false` when nothing did.
 *
 * @example
 * ```ts
 * const copied = await writeClipboard(objectsToClipboard(objects, window.location.origin));
 * ```
 */
export async function writeClipboard(payload: ClipboardPayload): Promise<boolean> {
  const clipboard = asyncClipboard();
  if (clipboard === undefined) return false;

  if (payload.html !== '' && canWriteRichClipboard()) {
    try {
      // Built before any await, from already-resolved promises — see the module remarks on Safari.
      const item = new ClipboardItem({
        'text/html': Promise.resolve(new Blob([payload.html], { type: 'text/html' })),
        'text/plain': Promise.resolve(new Blob([payload.text], { type: 'text/plain' })),
      });
      await clipboard.write([item]);
      return true;
    } catch {
      // Fall through: a refused rich write is still worth completing as a plain one.
    }
  }

  try {
    await clipboard.writeText(payload.text);
    return true;
  } catch {
    return false;
  }
}

/**
 * Put a formatted payload on a `copy` event's own clipboard data.
 *
 * @remarks
 * The synchronous counterpart of {@link writeClipboard}, for handlers that are *intercepting* a
 * copy the user already initiated rather than starting one. Writing through the event is strictly
 * better there: it needs no permission prompt, it cannot lose the gesture, and it keeps the
 * clipboard's other flavors (which the browser has already staged) coherent.
 *
 * The caller is responsible for `preventDefault()` — without it the browser overwrites everything
 * set here with its own default serialization.
 *
 * @param clipboardData - The event's `clipboardData`, or `null` when the event carried none.
 * @param payload - The rich and plain flavors to write.
 * @returns `true` when the flavors were written.
 */
export function writeClipboardData(
  clipboardData: DataTransfer | null,
  payload: ClipboardPayload,
): boolean {
  if (clipboardData === null) return false;
  try {
    clipboardData.setData('text/plain', payload.text);
    // Same rule as the async path: no rich form is better than an empty one.
    if (payload.html !== '') clipboardData.setData('text/html', payload.html);
    return true;
  } catch {
    return false;
  }
}

/**
 * Escape text for safe inclusion in the `text/html` flavor.
 *
 * @remarks
 * Lives here rather than in a serializer because *every* producer of a payload needs it and there
 * must be exactly one answer. A task titled `Fix <Button> & <Input>` has to survive as text, not
 * arrive at the paste target as two unknown elements.
 *
 * @param value - Raw text, typically an object title.
 * @returns The text with HTML-significant characters escaped.
 */
export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
