'use client';

/**
 * Drive the `@` menu from inside a ProseMirror editor.
 *
 * @remarks
 * Owns the trigger state, the caret geometry the popover anchors to, the highlighted row, and the
 * keyboard contract. Everything it returns is meant to be handed to `FreeformTextEditor`, which
 * keeps the editor itself unaware of how mentions work.
 *
 * The keyboard handler is returned rather than installed as a plugin keymap: ProseMirror consults
 * `editorProps.handleKeyDown` before any plugin keymap, and the editor already handles Escape
 * there to cancel an edit, so a plugin keymap would never see it.
 */
import { useCallback, useMemo, useRef, useState } from 'react';
import type { Editor } from '@tiptap/core';
import type { EditorView } from '@tiptap/pm/view';
import type { MentionItem, MentionRef } from '@docket/types';
import { mentionRefKey } from '@docket/types';
import { readStoredJson, writeStoredJson } from '@docket/ui/lib/browser-storage';

import { MENTION_NODE, attributesFromRef } from './mention-extension';
import { decideTrigger, type MentionTrigger } from './mention-trigger';
import { stepActiveKey } from './mention-merge';

/**
 * The geometry the menu positions against.
 *
 * @remarks
 * Radix accepts any object with this one method as a virtual anchor, which is how the menu
 * attaches to a caret rather than to an element that does not exist.
 */
export interface CaretAnchor {
  getBoundingClientRect: () => DOMRect;
}

/** What the editor needs from the controller. */
export interface MentionController {
  readonly open: boolean;
  readonly query: string;
  /** The row the user arrowed to, which the menu resolves against the rows it currently has. */
  readonly activeKey: string | undefined;
  /** Whether the user has arrowed, which is what pins the highlight against late arrivals. */
  readonly hasArrowed: boolean;
  /** Called by the menu each render, so the keyboard handler reads rows synchronously. */
  readonly reportRows: (
    items: readonly MentionItem[],
    resolvedActiveKey: string | undefined,
  ) => void;
  readonly anchorRef: React.RefObject<CaretAnchor | null>;
  readonly listboxId: string;
  /** Install as the first branch of the editor's own `handleKeyDown`. */
  readonly handleKeyDown: (view: EditorView, event: KeyboardEvent) => boolean;
  /** Call from the editor's update handler so the trigger tracks the caret. */
  readonly syncFromEditor: (editor: Editor) => void;
  readonly selectItem: (item: MentionItem) => void;
  readonly close: () => void;
  /** Close because the reader asked to, which keeps this `@` shut until the caret leaves it. */
  readonly dismiss: () => void;
  /** True while the menu is open, so the editor suppresses content reconciliation. */
  readonly suppressReconcile: React.RefObject<boolean>;
}

/** How mentions are configured for one editor. */
export interface MentionControllerOptions {
  /** The workspace whose entities are mentionable; undefined turns mentions off. */
  readonly orgId: string | undefined;
  /** False for a read-only or disabled surface, where `@` is just a character. */
  readonly enabled: boolean;
}

/**
 * Wire up mention behavior for one editor.
 *
 * @param input - The org whose entities are mentionable, and whether mentions are on at all.
 * @returns The controller.
 */
export function useMentionController(input: MentionControllerOptions): MentionController {
  const [trigger, setTrigger] = useState<MentionTrigger | undefined>(undefined);
  const [activeKey, setActiveKey] = useState<string | undefined>(undefined);
  const [hasArrowed, setHasArrowed] = useState(false);
  const editorRef = useRef<Editor | null>(null);
  const anchorRef = useRef<CaretAnchor | null>(null);
  const itemsRef = useRef<readonly MentionItem[]>([]);
  const resolvedKeyRef = useRef<string | undefined>(undefined);
  const dismissedStartRef = useRef<number | undefined>(undefined);
  // The keyboard handler reads the trigger from here rather than from the render it closed over.
  // ProseMirror dispatches a keystroke synchronously, so a handler that trusted its captured state
  // would act on whatever the last committed render happened to hold.
  const triggerRef = useRef<MentionTrigger | undefined>(undefined);
  // Set for exactly one keystroke, so the Escape that dismissed the menu is swallowed and the one
  // after it reaches the editor.
  const justDismissedRef = useRef(false);
  const suppressReconcile = useRef(false);
  const listboxId = useMemo(() => `mention-menu-${Math.random().toString(36).slice(2, 9)}`, []);

  triggerRef.current = trigger;

  const open = input.enabled && input.orgId !== undefined && trigger !== undefined;
  suppressReconcile.current = open;

  // Rows live in a ref because the search query is mounted by the menu, which only exists while
  // the menu is open. A surface where nobody typed `@` mounts no query and needs no QueryClient.
  const reportRows = useCallback((next: readonly MentionItem[], resolved: string | undefined) => {
    itemsRef.current = next;
    resolvedKeyRef.current = resolved;
  }, []);

  const close = useCallback(() => {
    setTrigger(undefined);
    setActiveKey(undefined);
    setHasArrowed(false);
  }, []);

  /**
   * Close the menu and keep it closed for this `@`.
   *
   * @remarks
   * Radix answers Escape from a capture-phase listener on the document, so the popover is already
   * gone by the time ProseMirror hands the key to us. Recording the dismissal here rather than in
   * the key handler is what makes it stick no matter which of the two closed the menu.
   */
  const dismiss = useCallback(() => {
    dismissedStartRef.current = triggerRef.current?.start;
    justDismissedRef.current = true;
    close();
  }, [close]);

  const syncFromEditor = useCallback(
    (editor: Editor) => {
      editorRef.current = editor;
      if (!input.enabled) return;

      const { state: editorState, view } = editor;
      const { from, empty } = editorState.selection;
      if (!empty) {
        close();
        return;
      }

      const blockStart = editorState.selection.$from.start();
      const decision = decideTrigger({
        textBeforeCaret: editorState.doc.textBetween(blockStart, from, '\n', '￼'),
        origin: blockStart,
        dismissedStart: dismissedStartRef.current,
      });

      if (decision.kind === 'suppressed') return;
      justDismissedRef.current = false;
      if (decision.kind === 'none') {
        dismissedStartRef.current = undefined;
        if (triggerRef.current !== undefined) close();
        return;
      }

      dismissedStartRef.current = undefined;
      const { start } = decision.trigger;
      // Anchor to the whole `@query` range rather than to a caret point, so the menu stays glued
      // to the growing token instead of drifting as characters are added.
      const rect = () => {
        const box = view.coordsAtPos(start);
        const end = view.coordsAtPos(from);
        return new DOMRect(
          box.left,
          box.top,
          Math.max(end.right - box.left, 1),
          box.bottom - box.top,
        );
      };
      anchorRef.current = { getBoundingClientRect: rect };
      setTrigger(decision.trigger);
    },
    [close, input.enabled],
  );

  const selectItem = useCallback(
    (item: MentionItem) => {
      const editor = editorRef.current;
      const active = triggerRef.current;
      if (editor === null || active === undefined) return;

      const ref: MentionRef = item.ref;
      const href = item.origin === 'local' ? item.href : item.url;
      const from = active.start;
      const to = from + 1 + active.query.length;

      editor
        .chain()
        .focus()
        .insertContentAt({ from, to }, [
          { type: MENTION_NODE, attrs: attributesFromRef(ref, item.title, href) },
          // A trailing space, because nobody who inserts a mention wants their next character
          // glued to it.
          { type: 'text', text: ' ' },
        ])
        .run();

      rememberMention(ref);
      close();
    },
    [close],
  );

  const handleKeyDown = useCallback(
    (_view: EditorView, event: KeyboardEvent): boolean => {
      if (event.key === 'Escape' && justDismissedRef.current) {
        // Returning true stops the editor's own Escape handler, so dismissing the menu does not
        // discard the draft.
        justDismissedRef.current = false;
        event.preventDefault();
        return true;
      }

      if (triggerRef.current === undefined || !input.enabled || input.orgId === undefined) {
        return false;
      }

      // Not intercepted: ⌘Enter means send. Leaving a half-typed `@dri` as literal text is
      // recoverable; inserting an unconfirmed mention is not.
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') return false;

      switch (event.key) {
        case 'ArrowDown':
        case 'ArrowUp': {
          event.preventDefault();
          setHasArrowed(true);
          setActiveKey(
            stepActiveKey(
              itemsRef.current,
              resolvedKeyRef.current,
              event.key === 'ArrowDown' ? 1 : -1,
            ),
          );
          return true;
        }
        case 'Home':
        case 'End': {
          if (itemsRef.current.length === 0) return false;
          event.preventDefault();
          setHasArrowed(true);
          setActiveKey(
            event.key === 'Home'
              ? itemsRef.current[0]?.id
              : itemsRef.current[itemsRef.current.length - 1]?.id,
          );
          return true;
        }
        case 'Enter':
        case 'Tab': {
          const item =
            itemsRef.current.find((candidate) => candidate.id === resolvedKeyRef.current) ??
            itemsRef.current[0];
          if (item === undefined) return false;
          event.preventDefault();
          selectItem(item);
          return true;
        }
        case 'Escape': {
          event.preventDefault();
          dismiss();
          return true;
        }
        default:
          return false;
      }
    },
    [dismiss, input.enabled, input.orgId, selectItem],
  );

  return {
    open,
    query: trigger?.query ?? '',
    activeKey,
    hasArrowed,
    reportRows,
    anchorRef,
    listboxId,
    handleKeyDown,
    syncFromEditor,
    selectItem,
    close,
    dismiss,
    suppressReconcile,
  };
}

/** Where the recently-inserted mention keys live between sessions. */
const RECENT_MENTIONS_KEY = 'docket.mentions.recent';

/** How many recent mentions bare `@` offers back before the oldest falls off. */
const RECENT_MENTIONS_LIMIT = 8;

/** Remember an inserted reference so bare `@` can offer it back immediately next time. */
function rememberMention(ref: MentionRef): void {
  const stored = readStoredJson(RECENT_MENTIONS_KEY);
  // Filtered to strings rather than asserted as `string[]`. This list is written by builds older
  // than this one and is hand-editable, so a single non-string entry used to reach `.filter` on a
  // value the type system had already promised was a string.
  const previous = Array.isArray(stored) ? stored.filter((k) => typeof k === 'string') : [];
  const key = mentionRefKey(ref);
  const next = [key, ...previous.filter((k) => k !== key)].slice(0, RECENT_MENTIONS_LIMIT);
  writeStoredJson(RECENT_MENTIONS_KEY, next);
}
