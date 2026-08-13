/**
 * `lib/clipboard/write` — the one place Docket puts formatted content on the clipboard.
 *
 * @remarks
 * A copy carries two flavors at once: `text/html`, and `text/plain` holding Markdown. The paste
 * target picks — Docs, Notion, Slack and Linear take the HTML; editors and terminals take the
 * Markdown.
 *
 * Two platform rules shape the implementation:
 *
 * - WebKit honors a clipboard write only inside the user gesture that triggered it. The
 *   `ClipboardItem` is built from already-resolved promises before any `await`.
 * - Callers are event handlers. Writes report success as a boolean and throw nothing.
 *
 * @see {@link ./object-clipboard} for the flavors produced for core objects.
 * @see {@link ../use-copy-feedback} for rendering the result.
 */

/** The two flavors every Docket copy writes. */
export interface ClipboardPayload {
  /**
   * The rich flavor, taken by editors that render structure. A bare fragment, carrying no `<html>`
   * or `<body>` wrapper.
   *
   * @remarks
   * An empty string marks content with no rich form, such as a code fence. The write then carries
   * `text/plain` alone. An empty `text/html` flavor makes a rich target paste nothing.
   */
  readonly html: string;
  /**
   * The plain flavor, taken by everything else. Always Markdown for Docket content.
   */
  readonly text: string;
}

/**
 * Whether this device has a clipboard. Callers hide a copy affordance where it does not.
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
 * embedded webviews. The DOM lib types it as always present, hence the cast.
 */
function asyncClipboard(): Clipboard | undefined {
  if (typeof navigator === 'undefined') return undefined;
  return (navigator as { clipboard?: Clipboard }).clipboard;
}

/**
 * Whether this device can carry more than one flavor. Where `false`, {@link writeClipboard} writes
 * the Markdown flavor alone.
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
 * Where the multi-flavor API is missing or refuses, falls back to `writeText` with the Markdown
 * flavor. Must be called synchronously from a user gesture; see the module remarks.
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
      // Built before any await, from already-resolved promises. See the module remarks on Safari.
      const item = new ClipboardItem({
        'text/html': Promise.resolve(new Blob([payload.html], { type: 'text/html' })),
        'text/plain': Promise.resolve(new Blob([payload.text], { type: 'text/plain' })),
      });
      await clipboard.write([item]);
      return true;
    } catch {
      // Falls through to the plain write below.
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
 * The synchronous counterpart of {@link writeClipboard}, for handlers intercepting a copy already
 * in flight. Needs no permission prompt and holds the user gesture.
 *
 * The caller calls `preventDefault()`; without it the browser overwrites everything set here.
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
 * Escape text for inclusion in the `text/html` flavor, so a title like `Fix <Button> & <Input>`
 * arrives as that text.
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
