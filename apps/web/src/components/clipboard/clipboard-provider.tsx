'use client';

/**
 * `components/clipboard/clipboard-provider` — the app's one ⌘C handler.
 *
 * @remarks
 * The sibling of {@link ../context-menu/object-context-menu}, built the same way: exactly one
 * document-level listener, which knows nothing about tasks, projects, or which surfaces exist. It
 * reads what the user is copying and answers in the richest form available.
 *
 * Two things can be copied outside a text input, resolved in priority order:
 *
 * 1. **A selection inside rendered Markdown** — a posted comment, a read-only body. Those are walked
 *    from `marked` tokens straight into React elements, so the selection's own DOM is read back into
 *    Markdown.
 * 2. **A focused object with no selection** — a task row, a project row. The browser's answer here
 *    is an empty string, which is what makes claiming ⌘C defensible.
 *
 * Everything else keeps the platform's own copy, and the refusals matter as much as the claims:
 *
 * - Ordinary selected text outside rendered Markdown.
 * - Inputs, textareas, and the rich-text editor, which carries its own Markdown serializer
 *   ({@link ../editor/markdown-clipboard}).
 * - No selection and no object under focus.
 *
 * ## Why it writes through the event
 *
 * `clipboardData.setData` is synchronous, needs no permission prompt, and holds the user gesture. A
 * `copy` listener is the one place the platform hands over the clipboard for free.
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
 * Kept in step with the context menu's equivalent list, so the same surfaces that keep the
 * platform's menu keep the platform's copy.
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
 * A selection *inside* a fence clones only text nodes and highlight spans, leaving the `<pre>` out of
 * the fragment, so the walker reads loose inline content as prose: it escapes `[`, `*` and backticks
 * and collapses the newlines between lines of code. The browser copies source verbatim, so these
 * selections stay with the platform.
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
 * `preventDefault` discards the browser's own `text/html`, so it is rebuilt here, minus the chrome.
 * A code block's language picker and Copy button live inside the block's element, and dropping them
 * keeps the words "TypeScript" and "Copy" out of the pasted document.
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
 * is the document body. Focus is consulted first, because it names the thing the user is on. Reached
 * only when there is no selection; a selection speaks for itself.
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

  // Copying inside a selection copies the selection, matching the right-click menu.
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
 * A copy invoked from the context menu closes the menu on select, leaving no control to carry its
 * own acknowledgement. Reporting here surfaces a refused write — permission policy, an embedded
 * webview, a transient denial — while the user is still looking.
 *
 * @returns The reporter, or a no-op outside the provider, so a caller can always call it.
 */
export function useCopyOutcome(): CopyOutcomeReporter {
  return useContext(CopyOutcomeContext) ?? noopReporter;
}

/** The reporter used outside the provider, so callers need no null check. */
function noopReporter(): void {
  // With no provider mounted there is nowhere to show an outcome.
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

      // A copy is about what is *selected*, and falls back to what is focused only when nothing is.
      // Type in the comment composer, then drag-select a comment above and press ⌘C: focus is still
      // inside the editor, and the selection is what the user means.
      const origin = hasSelection
        ? elementOf(selection.getRangeAt(0).commonAncestorContainer)
        : copyOrigin(event);
      // Text surfaces own their own copy, whatever is or is not selected inside them.
      if (origin?.closest(NATIVE_COPY_SELECTOR) != null) return;

      // `preventDefault` only after a successful write, so a refused write leaves the browser's own
      // copy in place.
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
        Failure is shown, because nothing else in the interface reveals it. Success stays in the
        live region: the clipboard already holds what the user asked for.
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
