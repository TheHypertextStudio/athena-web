/**
 * `lib/clipboard/write` — the one place Docket puts formatted content on the clipboard.
 *
 * @remarks
 * The web clipboard is a multi-flavor surface. A single {@link ClipboardItem} carries `text/html`
 * and `text/plain` at once, and the *paste target* decides which one it wants: Google Docs, Notion,
 * Slack and Linear take the HTML and render real headings and lists, while a code editor, a
 * terminal or a Markdown file takes the plain text. Writing both is the whole trick behind "copy
 * preserves formatting" — both answers are already on the clipboard, so the user picks by choosing
 * where to paste.
 *
 * Docket's plain-text flavor is **Markdown**. Bodies are stored as Markdown, so the plain flavor is
 * the source itself, which makes a Docket → editor → Docket round trip lossless.
 *
 * ## Two platform constraints this module encapsulates
 *
 * **Safari needs the promises synchronously.** WebKit honors a clipboard write only while it is
 * still inside the user gesture that triggered it, so the item is built from already-resolved
 * promises in the same tick the caller was entered, and only the `write()` call is awaited.
 *
 * **Failure stays inside.** Every caller is an event handler — a menu item, a `copy` listener —
 * that must keep working when the clipboard refuses, so the API reports success as a boolean and
 * callers render feedback from it.
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
   * A bare fragment. Receiving apps splice it into their own document, so it carries no `<html>` or
   * `<body>` wrapper.
   *
   * An empty string means *this content has no rich form* (a code fence, a bare identifier). The
   * write then carries plain text alone, because a rich target that finds an empty `text/html`
   * flavor prefers it and pastes nothing.
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
 * Callers use this to hide a copy affordance where the platform has no clipboard, matching the
 * precedent set by `task.copyLink`.
 *
 * @returns `true` when the async clipboard API is present.
 */
export function canWriteClipboard(): boolean {
  return typeof asyncClipboard()?.writeText === 'function';
}

/**
 * The async clipboard, when this context has one.
 *
 * @remarks
 * `navigator.clipboard` is absent in a non-secure context, during server rendering, and in some
 * embedded webviews, while the DOM lib types it as always present. The cast lets the runtime check
 * hold on those devices.
 */
function asyncClipboard(): Clipboard | undefined {
  if (typeof navigator === 'undefined') return undefined;
  return (navigator as { clipboard?: Clipboard }).clipboard;
}

/**
 * Whether this device can carry more than one flavor.
 *
 * @remarks
 * Exported for tests and for callers explaining a degraded copy. Where this is `false`,
 * {@link writeClipboard} still writes the Markdown flavor.
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
 * flavor still lands via `writeText`. A caller handles two outcomes, "it worked" and "it did not",
 * and stays free of platform branching.
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
      // A refused rich write still completes as a plain one.
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
 * The synchronous counterpart of {@link writeClipboard}, for handlers intercepting a copy the user
 * already initiated. Writing through the event needs no permission prompt, holds the gesture, and
 * keeps the flavors the browser has already staged coherent.
 *
 * The caller is responsible for `preventDefault()`; the browser overwrites everything set here with
 * its own serialization otherwise.
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
    // Same rule as the async path: an empty rich form is left off entirely.
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
 * Every producer of a payload needs it, and there is exactly one answer, so it lives here. A task
 * titled `Fix <Button> & <Input>` arrives at the paste target as that text.
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
