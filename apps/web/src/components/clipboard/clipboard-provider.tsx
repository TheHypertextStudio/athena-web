'use client';

/**
 * `components/clipboard/clipboard-provider` — the app's one ⌘C handler.
 *
 * @remarks
 * Built the same way as {@link ../context-menu/object-context-menu}, and for the same reason:
 * exactly one document-level listener, which knows nothing about tasks, projects, or which surfaces
 * exist. It looks at what the user is actually copying and answers in the richest form available.
 *
 * Two things can be copied outside a text input, and this handler resolves them in priority order:
 *
 * 1. **A selection inside rendered Markdown** — a posted comment, a read-only body. Those are walked
 *    from `marked` tokens directly into React elements rather than mounted in an editor, so they
 *    have no serializer of their own and the browser's plain flavor flattens every heading and
 *    bullet away. The selection's own DOM is read back into Markdown instead.
 * 2. **A focused object with no selection** — a task row, a project row. The browser's answer here
 *    is an empty string, which is the only reason claiming ⌘C is defensible at all.
 *
 * Everything else is left alone, and the refusals matter more than the claims:
 *
 * - Ordinary selected text outside rendered Markdown copies natively.
 * - Inputs, textareas, and the rich-text editor keep their own behavior — in the editor's case a
 *   Markdown serializer ({@link ../editor/markdown-clipboard}) that is better than this one.
 * - No selection and no object under focus means there is nothing to say.
 *
 * ## Why it writes through the event
 *
 * `clipboardData.setData` needs no permission prompt, cannot lose the user gesture, and is
 * synchronous — all three of which the async clipboard API can fail at. A `copy` listener is the one
 * place the platform hands over the clipboard for free.
 *
 * @see {@link ../../lib/clipboard/html-to-markdown} for the rendered-Markdown walker.
 * @see {@link ../../lib/clipboard/object-clipboard} for what an object looks like on the clipboard.
 */
import { createContext, type JSX, type ReactNode, useContext, useEffect, useMemo } from 'react';

import { readSelectionSurfaceFor } from '@/components/selection/selection-registry';
import { OBJECT_TARGET_SELECTOR, objectKey, readObjectTarget } from '@/lib/actions/object';
import { htmlFragmentToMarkdown } from '@/lib/clipboard/html-to-markdown';
import { objectsToClipboard } from '@/lib/clipboard/object-clipboard';
import { writeClipboardData } from '@/lib/clipboard/write';
import { useCopyFeedback } from '@/lib/use-copy-feedback';

/**
 * Elements whose own copy behavior is always preserved.
 *
 * @remarks
 * Kept in step with the context menu's equivalent list on purpose: the same surfaces that keep the
 * platform's menu keep the platform's copy. A divergence would mean a row that can be right-clicked
 * but not copied, or an editor whose selection is serialized twice.
 */
const NATIVE_COPY_SELECTOR =
  '[data-native-context-menu="true"], [data-editor-surface], input, textarea, select, [contenteditable=""], [contenteditable="true"]';

/** The container marking content that was rendered from stored Markdown. */
const RENDERED_MARKDOWN_SELECTOR = '[data-static-markdown]';

/** Chrome that is part of the reading experience but never part of the content. */
const NON_CONTENT_SELECTOR = 'button, select, [aria-hidden="true"], .sr-only';

/**
 * Code, where the prose walker must not go.
 *
 * @remarks
 * A selection *inside* a fence clones only text nodes and highlight spans — the `<pre>` itself is
 * not in the fragment — so the walker sees loose inline content and treats it as prose: it escapes
 * `[`, `*` and backticks, and collapses the newlines between lines of code. Two selected lines come
 * back as one line of backslash-littered source. Whole-block selections are fine (`codeOf` sees the
 * frame), so it is exactly the ordinary "select a few lines and copy" gesture that breaks. The
 * browser already copies code verbatim, so the right answer here is to decline.
 */
const CODE_SELECTOR = 'pre, [data-code-block]';

/** The nearest element for a node, which for a text node is its parent. */
function elementOf(node: Node | null): Element | null {
  if (node === null) return null;
  return node instanceof Element ? node : (node.parentElement ?? null);
}

/**
 * The rich flavor for a rendered-Markdown selection.
 *
 * @remarks
 * The browser's own `text/html` would be reused if `preventDefault` did not discard it, so it is
 * rebuilt here — minus the chrome. A code block's language picker and its Copy button live inside
 * the block's own element, and without this they paste into a document as the words "TypeScript"
 * and "Copy" sitting above the code.
 *
 * @param fragment - The selection's cloned contents.
 * @returns An HTML fragment string.
 */
function fragmentToHtml(fragment: DocumentFragment): string {
  const host = document.createElement('div');
  host.append(fragment);
  for (const chrome of Array.from(host.querySelectorAll(NON_CONTENT_SELECTOR))) chrome.remove();
  return host.innerHTML;
}

/** Copy a selection that lies inside rendered Markdown. Returns whether the event was claimed. */
function copyRenderedMarkdown(event: ClipboardEvent, selection: Selection): boolean {
  const range = selection.getRangeAt(0);
  const anchor = elementOf(range.commonAncestorContainer);
  const container = anchor?.closest(RENDERED_MARKDOWN_SELECTOR);
  if (container === undefined || container === null) return false;
  // Inside a fence the platform's own verbatim copy is the correct answer; see CODE_SELECTOR.
  if (anchor?.closest(CODE_SELECTOR) != null) return false;

  const markdown = htmlFragmentToMarkdown(range.cloneContents());
  if (markdown === '') return false;

  return writeClipboardData(event.clipboardData, {
    text: markdown,
    html: fragmentToHtml(range.cloneContents()),
  });
}

/**
 * The element a copy should be attributed to when nothing is selected.
 *
 * @remarks
 * `event.target` on a `copy` event is whatever the selection is anchored in, which with no selection
 * is the document body rather than the focused row. So focus is consulted first — it is what the
 * user would name if asked which thing they were on. Only reached when there is no selection; a
 * selection always speaks for itself.
 *
 * @param event - The copy event.
 * @returns The element to walk up from, or `null`.
 */
function copyOrigin(event: ClipboardEvent): Element | null {
  const active = document.activeElement;
  if (active !== null && active !== document.body) return active;
  return event.target instanceof Element ? event.target : null;
}

/** Copy the focused object, or the selection it belongs to. Returns whether the event was claimed. */
function copyFocusedObject(event: ClipboardEvent): boolean {
  const origin = copyOrigin(event);
  if (origin === null) return false;

  const host = origin.closest(OBJECT_TARGET_SELECTOR);
  const object = readObjectTarget(host);
  if (object === null) return false;

  // Copying inside a selection copies the selection, matching what the right-click menu does.
  const surface = readSelectionSurfaceFor(host);
  const inSelection =
    surface?.selectedObjects.some((selected) => objectKey(selected) === objectKey(object)) ?? false;
  const objects = inSelection && surface !== null ? surface.selectedObjects : [object];

  const payload = objectsToClipboard(objects, window.location.origin);
  if (payload.text === '') return false;
  return writeClipboardData(event.clipboardData, payload);
}

/** Props for {@link ClipboardProvider}. */
export interface ClipboardProviderProps {
  /** The app subtree served by this handler. Mount exactly one, at the root. */
  readonly children: ReactNode;
}

/** Report the outcome of a copy performed away from any control that could show its own state. */
type CopyOutcomeReporter = (wrote: boolean) => void;

const CopyOutcomeContext = createContext<CopyOutcomeReporter | null>(null);

/**
 * Report whether a copy reached the clipboard.
 *
 * @remarks
 * A copy invoked from the context menu has nowhere to put its own acknowledgement: the menu closes
 * on select, so the pattern used by the code-block button — swap the label, announce politely — has
 * no control left to swap. Reporting here instead means a refused write (permission policy, an
 * embedded webview, a transient denial) is seen rather than leaving the user to discover it when
 * they paste something stale.
 *
 * @returns The reporter, or a no-op outside the provider so a caller never has to branch.
 */
export function useCopyOutcome(): CopyOutcomeReporter {
  return useContext(CopyOutcomeContext) ?? noopReporter;
}

/** The reporter used outside the provider, so callers need no null check. */
function noopReporter(): void {
  // Intentionally nothing: with no provider there is nowhere to show an outcome.
}

/**
 * Install the app's single copy handler.
 *
 * @param props - The app subtree.
 * @returns The subtree, unchanged — this provider renders no DOM of its own.
 */
export function ClipboardProvider({ children }: ClipboardProviderProps): JSX.Element {
  const feedback = useCopyFeedback({
    copiedMessage: 'Copied.',
    failedMessage: 'Could not copy. Try again.',
  });
  const report = feedback.report;
  const outcome = useMemo<CopyOutcomeReporter>(() => report, [report]);

  useEffect(() => {
    function onCopy(event: ClipboardEvent): void {
      const selection = window.getSelection();
      const hasSelection =
        selection !== null &&
        selection.rangeCount > 0 &&
        !selection.isCollapsed &&
        selection.toString().trim() !== '';

      // A copy is about what is *selected*, and only falls back to what is focused when nothing is.
      // Asking focus first gets the common case wrong: type in the comment composer, then drag-select
      // a comment above and press ⌘C — focus is still inside the editor, so a focus-keyed guard would
      // hand back the browser's flattened text for a selection that is nowhere near it.
      const origin = hasSelection
        ? elementOf(selection.getRangeAt(0).commonAncestorContainer)
        : copyOrigin(event);
      // Text surfaces own their own copy, whatever is or is not selected inside them.
      if (origin?.closest(NATIVE_COPY_SELECTOR) != null) return;

      // `preventDefault` only after a successful write: preventing it and then failing would leave
      // the clipboard holding whatever it had before, with no sign anything went wrong.
      const claimed = hasSelection
        ? copyRenderedMarkdown(event, selection)
        : copyFocusedObject(event);
      if (claimed) event.preventDefault();
    }

    document.addEventListener('copy', onCopy);
    return () => {
      document.removeEventListener('copy', onCopy);
    };
  }, []);

  return (
    <CopyOutcomeContext.Provider value={outcome}>
      {children}
      {/*
        Only a failure is shown. A copy that worked needs no visual receipt — the clipboard now
        holds what the user asked for, and a confirmation for every ⌘C would be noise. A copy that
        did *not* work is the case worth interrupting for, because nothing else in the interface
        will ever reveal it.
      */}
      {feedback.state === 'failed' ? (
        <div
          data-copy-status="failed"
          className="border-outline-variant bg-surface-container-high text-on-surface text-body-small pointer-events-none fixed inset-x-0 bottom-6 z-50 mx-auto w-fit rounded-lg border px-3 py-2 shadow-lg"
        >
          {feedback.announcement}
        </div>
      ) : null}
      <p role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {feedback.announcement}
      </p>
    </CopyOutcomeContext.Provider>
  );
}
