'use client';

import type { MentionChoice } from './mention-choice';

/**
 * A plain textarea that answers `@` with the same picker the rich editor uses.
 *
 * @remarks
 * A textarea, not a hidden rich editor. The surfaces this serves are deliberately plain: the Athena
 * composers send strings to a model, and the Today box is a paste-a-whole-backlog target. Swapping
 * either for ProseMirror would change the payload, the Enter semantics, and the autosize behavior
 * to gain a chip nobody asked for there.
 *
 * What differs between those surfaces is only what an insert leaves behind, which is the
 * {@link MentionInsertMode} below. Everything else — the menu, the keyboard model, the anti-jump
 * rules — is shared with the editor.
 */
import { cn } from '@docket/ui/lib/utils';
import type { MentionItem } from '../../lib/contracts/mention';
import { formatMentionLink } from '../../lib/contracts/mention';
import { useCallback, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { TextareaHTMLAttributes } from 'react';

import MentionMenu from './mention-menu';
import { decideTrigger } from './mention-trigger';
import { stepActiveKey } from './mention-merge';
import { measureCaretRect, type Rect } from './textarea-caret-rect';

/**
 * What inserting a reference writes into the text.
 *
 * @remarks
 * `prose` writes the canonical Markdown link, so what the author posts renders as a chip for
 * everyone who reads it later. `context` writes a bare `@Title` and hands the structured reference
 * back through {@link MentionTextareaProps.onReference}, because a model prompt is not a document
 * and Markdown link syntax in it is noise the model has to see past.
 */
export type MentionInsertMode = 'prose' | 'context';

/** Props for {@link MentionTextarea}. */
export interface MentionTextareaProps extends Omit<
  TextareaHTMLAttributes<HTMLTextAreaElement>,
  'value' | 'onChange'
> {
  readonly value: string;
  readonly onChange: (value: string) => void;
  /** The workspace whose entities are mentionable; absent turns `@` back into a character. */
  readonly orgId?: string;
  /** What an insert writes. Defaults to prose, which is what a persisted field wants. */
  readonly insertMode?: MentionInsertMode;
  /** Called with the reference on insert, so a context surface can carry it alongside the text. */
  readonly onReference?: (item: MentionItem) => void;
  /**
   * Grow the field to fit its own content, up to {@link maxRows}.
   *
   * @remarks
   * Off by default: a persisted field with a fixed `rows` is a stable target, and changing that
   * under every existing caller would move four Athena composers at once. Composers opt in.
   *
   * The alternative callers reach for is a ternary on `value.length`, which is a guess about where
   * text wraps and is wrong at every width it was not tuned for. This measures instead.
   */
  readonly autoGrow?: boolean;
  /** Row cap for {@link autoGrow}; past it the field scrolls. Defaults to 12. */
  readonly maxRows?: number;
}

/** A caret anchor Radix can position against. */
function anchorFor(rect: Rect): { getBoundingClientRect: () => DOMRect } {
  return {
    getBoundingClientRect: () =>
      new DOMRect(rect.left, rect.top, Math.max(rect.width, 1), rect.height),
  };
}

/**
 * Render a textarea with mention support.
 *
 * @returns The field, plus its menu when one is open.
 */
export default function MentionTextarea({
  value,
  onChange,
  orgId,
  insertMode = 'prose',
  onReference,
  autoGrow = false,
  maxRows = 12,
  className,
  onKeyDown,
  ...rest
}: MentionTextareaProps): React.JSX.Element {
  const editable = !rest.readOnly && !rest.disabled;
  const canMention = editable && orgId !== undefined;
  const frozenCreation = useRef<{ value: string; start: number; query: string } | null>(null);
  const fieldRef = useRef<HTMLTextAreaElement | null>(null);
  const anchorRef = useRef<{ getBoundingClientRect: () => DOMRect } | null>(null);
  const itemsRef = useRef<readonly MentionChoice[]>([]);
  const resolvedKeyRef = useRef<string | undefined>(undefined);
  const dismissedStartRef = useRef<number | undefined>(undefined);
  // Set for exactly one keystroke, so the Escape that dismissed the menu is swallowed and the one
  // after it reaches the composer.
  const justDismissedRef = useRef(false);
  const listboxId = useId();

  const [trigger, setTrigger] = useState<{ start: number; query: string } | undefined>(undefined);
  // The keyboard handler reads the trigger from here rather than from the render it closed over.
  // Radix reports open/closed on its own schedule, and a keystroke that arrives between a close
  // and the re-open that follows it would otherwise be handled as if no menu were on screen.
  const triggerRef = useRef<{ start: number; query: string } | undefined>(undefined);
  triggerRef.current = trigger;
  const [activeKey, setActiveKey] = useState<string | undefined>(undefined);
  const [hasArrowed, setHasArrowed] = useState(false);

  // One narrowing carrying both values, rather than a boolean the JSX then has to re-check.
  const session =
    editable && orgId !== undefined && trigger !== undefined ? { orgId, trigger } : undefined;
  const open = session !== undefined;

  useTextareaAutoGrow(fieldRef, autoGrow, maxRows, value);

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
   * gone by the time the field's own key handler runs. Recording the dismissal here rather than in
   * that handler is what makes it stick no matter which of the two closed the menu.
   */
  const dismiss = useCallback(() => {
    dismissedStartRef.current = triggerRef.current?.start;
    justDismissedRef.current = true;
    close();
  }, [close]);

  const reportRows = useCallback(
    (items: readonly MentionChoice[], resolved: string | undefined) => {
      if (items.length > 0) frozenCreation.current = null;
      itemsRef.current = items;
      resolvedKeyRef.current = resolved;
    },
    [],
  );

  /** Re-read the caret and decide whether a mention attempt is open. */
  const syncTrigger = useCallback(() => {
    const field = fieldRef.current;
    if (field === null || orgId === undefined || !editable) return;
    const caret = field.selectionStart;
    // Only the current line matters: a mention never spans a paragraph, and scanning the whole
    // value would find an `@` the author finished with three lines ago.
    const lineStart = field.value.lastIndexOf('\n', caret - 1) + 1;
    const decision = decideTrigger({
      textBeforeCaret: field.value.slice(lineStart, caret),
      origin: lineStart,
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
    anchorRef.current = anchorFor(measureCaretRect(field, decision.trigger.start));
    setTrigger(decision.trigger);
  }, [close, orgId, editable]);

  const selectItem = useCallback(
    (item: MentionChoice) => {
      if (item.origin === 'create-person') {
        const active = triggerRef.current;
        if (active) frozenCreation.current = { value, ...active };
        item.select();
        return;
      }
      const field = fieldRef.current;
      const frozen = frozenCreation.current;
      frozenCreation.current = null;
      const active = frozen ?? triggerRef.current;
      if (field === null || active === undefined || !editable) return;
      if (frozen && field.value !== frozen.value) {
        close();
        return;
      }

      const href = item.origin === 'local' ? item.href : item.url;
      const inserted =
        insertMode === 'prose' ? formatMentionLink(item.title, href, item.ref) : `@${item.title}`;

      insertTextareaMention(field, value, active, inserted, onChange);
      onReference?.(item);
      close();
    },
    [close, editable, insertMode, onChange, onReference, value],
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key === 'Escape' && justDismissedRef.current) {
        // Stops here, so dismissing the menu never also cancels the surrounding composer.
        justDismissedRef.current = false;
        event.preventDefault();
        event.stopPropagation();
        return;
      }

      if (canMention && triggerRef.current !== undefined) {
        // ⌘Enter still means send. Losing a half-typed `@dri` as literal text is recoverable;
        // inserting an unconfirmed mention is not.
        const isSubmit = (event.metaKey || event.ctrlKey) && event.key === 'Enter';
        if (!isSubmit) {
          switch (event.key) {
            case 'ArrowDown':
            case 'ArrowUp':
              event.preventDefault();
              setHasArrowed(true);
              setActiveKey(
                stepActiveKey(
                  itemsRef.current,
                  resolvedKeyRef.current,
                  event.key === 'ArrowDown' ? 1 : -1,
                ),
              );
              return;
            case 'Enter':
            case 'Tab': {
              const item =
                itemsRef.current.find((candidate) => candidate.id === resolvedKeyRef.current) ??
                itemsRef.current[0];
              if (item === undefined) break;
              event.preventDefault();
              selectItem(item);
              return;
            }
            case 'Escape':
              event.preventDefault();
              event.stopPropagation();
              dismiss();
              return;
            default:
              break;
          }
        }
      }
      onKeyDown?.(event);
    },
    [canMention, dismiss, onKeyDown, selectItem],
  );

  const menu = useMemo(
    () =>
      session === undefined ? null : (
        <MentionMenu
          open
          orgId={session.orgId}
          anchorRef={anchorRef}
          activeKey={activeKey}
          hasArrowed={hasArrowed}
          listboxId={listboxId}
          query={session.trigger.query}
          onSelect={selectItem}
          onRows={reportRows}
          onOpenChange={(next) => {
            if (!next) dismiss();
          }}
        />
      ),
    [activeKey, dismiss, hasArrowed, listboxId, reportRows, selectItem, session],
  );

  return (
    <>
      <textarea
        {...rest}
        ref={fieldRef}
        value={value}
        className={cn(className)}
        // Combobox semantics only where a picker can actually appear. A field with no popup that
        // claims to be a combobox tells a screen reader to expect a list that will never exist,
        // and changes the role a plain textarea reports for no benefit.
        {...mentionFieldAttributes(orgId, open, listboxId, activeKey)}
        onChange={(event) => {
          onChange(event.target.value);
          // After the value lands, so the caret offset matches the text being measured.
          requestAnimationFrame(syncTrigger);
        }}
        onKeyUp={syncTrigger}
        onClick={syncTrigger}
        onBlur={(event) => {
          // A click inside the menu blurs the field; closing then would cancel the very selection
          // being made. Radix keeps focus out of the popover, so anything else is a real exit.
          if (!event.relatedTarget?.closest('[data-mention-menu]')) {
            dismissedStartRef.current = undefined;
            close();
          }
          rest.onBlur?.(event);
        }}
        onKeyDown={handleKeyDown}
      />
      {menu}
    </>
  );
}

function useTextareaAutoGrow(
  fieldRef: React.RefObject<HTMLTextAreaElement | null>,
  autoGrow: boolean,
  maxRows: number,
  value: string,
): void {
  useLayoutEffect(() => {
    const field = fieldRef.current;
    if (!autoGrow || !field) return;
    field.style.height = 'auto';
    const lineHeight = Number.parseFloat(getComputedStyle(field).lineHeight);
    const cap = Number.isFinite(lineHeight) ? lineHeight * maxRows : Number.POSITIVE_INFINITY;
    field.style.height = `${String(Math.min(field.scrollHeight, cap))}px`;
    field.style.overflowY = field.scrollHeight > cap ? 'auto' : 'hidden';
  }, [autoGrow, fieldRef, maxRows, value]);
}

function insertTextareaMention(
  field: HTMLTextAreaElement,
  value: string,
  active: { start: number; query: string },
  inserted: string,
  onChange: (value: string) => void,
): void {
  const before = value.slice(0, active.start);
  const after = value.slice(active.start + 1 + active.query.length);
  onChange(`${before}${inserted} ${after}`);
  const caret = before.length + inserted.length + 1;
  requestAnimationFrame(() => {
    field.focus();
    field.setSelectionRange(caret, caret);
  });
}

function mentionFieldAttributes(
  orgId: string | undefined,
  open: boolean,
  listboxId: string,
  activeKey: string | undefined,
): TextareaHTMLAttributes<HTMLTextAreaElement> {
  if (orgId === undefined) return {};
  return {
    role: 'combobox',
    'aria-expanded': open,
    'aria-autocomplete': 'list',
    ...(open ? { 'aria-controls': listboxId, 'aria-activedescendant': activeKey } : {}),
  };
}
