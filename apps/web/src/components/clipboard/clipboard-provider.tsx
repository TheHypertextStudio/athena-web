'use client';

/**
 * `components/clipboard/clipboard-provider` — the app's one ⌘C handler.
 *
 * @remarks
 * One document-level listener, sibling to {@link ../context-menu/object-context-menu} and built the
 * same way: it knows nothing about tasks, projects, or which surfaces exist.
 *
 * It claims two cases, in order:
 *
 * 1. **A selection inside rendered Markdown** — a posted comment, a read-only body. Those render
 *    from `marked` tokens into React elements; the selection's DOM is read back into Markdown.
 * 2. **A focused object with no selection** — a task row, a project row, copied as a linked title.
 *
 * Everything else keeps the platform's copy: ordinary text selections, inputs, textareas, and the
 * rich-text editor with its own serializer ({@link ../editor/markdown-clipboard}).
 *
 * It writes through `clipboardData.setData`, which is synchronous, holds the user gesture, and
 * needs no permission prompt.
 *
 * @see {@link ../../lib/clipboard/html-to-markdown} for the rendered-Markdown walker.
 * @see {@link ../../lib/clipboard/object-clipboard} for an object's clipboard form.
 */
import { createContext, type JSX, type ReactNode, useContext, useEffect, useMemo } from 'react';

import { readSelectionSurfaceFor } from '@/components/selection/selection-registry';
import { OBJECT_TARGET_SELECTOR, objectKey, readObjectTarget } from '@/lib/actions/object';
import { htmlFragmentToMarkdown } from '@/lib/clipboard/html-to-markdown';
import { objectsToClipboard } from '@/lib/clipboard/object-clipboard';
import { writeClipboardData } from '@/lib/clipboard/write';
import { useCopyFeedback } from '@/lib/use-copy-feedback';

/**
 * Elements whose own copy behavior is always preserved. Kept in step with the context menu's
 * equivalent list.
 */
const NATIVE_COPY_SELECTOR =
  '[data-native-context-menu="true"], [data-editor-surface], input, textarea, select, [contenteditable=""], [contenteditable="true"]';

/** The container marking content that was rendered from stored Markdown. */
const RENDERED_MARKDOWN_SELECTOR = '[data-static-markdown]';

/** Chrome that is part of the reading experience but never part of the content. */
const NON_CONTENT_SELECTOR = 'button, select, [aria-hidden="true"], .sr-only';

/**
 * Code, which the browser copies verbatim.
 *
 * @remarks
 * A selection *inside* a fence clones only text nodes and highlight spans, leaving the `<pre>` out
 * of the fragment. The walker then reads it as prose: escaping `[`, `*` and backticks, and
 * collapsing the newlines between lines. These selections stay with the platform.
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
 * `preventDefault` discards the browser's `text/html`, so it is rebuilt here without the chrome. A
 * code block's language picker and Copy button sit inside the block's element and would paste as
 * the words "TypeScript" and "Copy".
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
 * The element a copy is attributed to when nothing is selected.
 *
 * @remarks
 * `event.target` on a `copy` event is whatever the selection is anchored in, which with no selection
 * is the document body. Focus names the row the user is on, so it is consulted first.
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
 * A context-menu copy closes the menu on select, leaving no control to carry an acknowledgement.
 * Reporting here surfaces a refused write — permission policy, an embedded webview, a transient
 * denial — while the user is still looking.
 *
 * @returns The reporter, or a no-op outside the provider.
 */
export function useCopyOutcome(): CopyOutcomeReporter {
  return useContext(CopyOutcomeContext) ?? noopReporter;
}

/** The reporter used outside the provider, so callers need no null check. */
function noopReporter(): void {
  // No provider mounted, nowhere to show an outcome.
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

      // The selection identifies the copy; focus answers only when there is none. Type in the
      // comment composer, then drag-select a comment above: focus is still inside the editor.
      const origin = hasSelection
        ? elementOf(selection.getRangeAt(0).commonAncestorContainer)
        : copyOrigin(event);
      // Text surfaces own their own copy, whatever is or is not selected inside them.
      if (origin?.closest(NATIVE_COPY_SELECTOR) != null) return;

      // `preventDefault` only after a successful write; a refused write keeps the browser's copy.
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
      {/* Failure is shown; nothing else in the interface reveals it. Success stays in the live
          region. */}
      {feedback.state === 'failed' ? (
        <div
          data-copy-status="failed"
          className="border-outline-variant bg-surface-container-high text-on-surface text-body-small pointer-events-none fixed inset-x-0 bottom-6 z-50 mx-auto w-fit rounded-lg border px-3 py-2"
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
