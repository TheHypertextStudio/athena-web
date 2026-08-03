'use client';

/**
 * The floating list that `@` and `/` open inside an editor.
 *
 * @remarks
 * One component for both triggers, because they are the same interaction: a filtered list
 * anchored to the caret, driven entirely from the keyboard, where Enter takes the highlighted
 * row and Escape leaves the typed text alone. Giving mentions and slash commands separate menus
 * would guarantee they drift.
 *
 * It is deliberately *not* a `DropdownMenu`. A Radix menu takes focus, and this list must leave
 * the caret in the editor so the person keeps typing to filter. So it renders as a plain
 * positioned `listbox` the editor's own keydown handler drives, with `aria-activedescendant`
 * carrying the highlight to assistive tech. Geometry (radius, padding, row height, leading-icon
 * column) is taken from the same MD3 menu metrics the real menus use, so it does not read as a
 * second, unrelated menu.
 *
 * It is fixed-positioned and clamped to the viewport with the same inset every other overlay in
 * the product keeps, so it can never be sliced by a window edge.
 */
import { OVERLAY_COLLISION_PADDING, Text } from '@docket/ui/primitives';
import { cn } from '@docket/ui/lib/utils';
import type { LucideIcon } from '@docket/ui/icons';
import { type JSX, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/** One row in the menu. */
export interface SuggestionItem {
  /** Stable id, used as the React key and the `aria-activedescendant` target. */
  readonly id: string;
  /** The row's primary label. */
  readonly label: string;
  /** A quieter second line, or `null`. */
  readonly hint: string | null;
  /** The leading glyph. */
  readonly icon: LucideIcon;
}

/** Props for {@link SuggestionMenu}. */
export interface SuggestionMenuProps {
  /** Where the trigger character sits, in viewport coordinates. */
  readonly anchor: DOMRect;
  /** The rows to show. Rendering with none shows the empty line rather than nothing. */
  readonly items: readonly SuggestionItem[];
  /** Index of the highlighted row. */
  readonly activeIndex: number;
  /** Move the highlight (hovering a row should preview it, as in every other menu). */
  readonly onActiveIndexChange: (index: number) => void;
  /** Take a row. */
  readonly onSelect: (index: number) => void;
  /** Application-owned line shown when nothing matches. */
  readonly emptyText: string;
  /** Accessible name for the list. */
  readonly ariaLabel: string;
  /** Id shared with the editor's `aria-owns`/`aria-activedescendant` wiring. */
  readonly listboxId: string;
}

/** Menu geometry, matched to the MD3 metrics the DropdownMenu primitive uses. */
const MENU_WIDTH = 288;
const MAX_HEIGHT = 288;

/**
 * The floating suggestion list.
 *
 * @param props - The {@link SuggestionMenuProps}.
 * @returns The portalled menu, or `null` before the document exists (SSR).
 */
export function SuggestionMenu({
  anchor,
  items,
  activeIndex,
  onActiveIndexChange,
  onSelect,
  emptyText,
  ariaLabel,
  listboxId,
}: SuggestionMenuProps): JSX.Element | null {
  const listRef = useRef<HTMLUListElement | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Keep the highlighted row in view when the keyboard walks past the fold. Guarded because
  // scrolling is a layout operation and environments without layout (jsdom) do not implement it —
  // a missing scroll must never take the menu down with it.
  useLayoutEffect(() => {
    const active = listRef.current?.querySelector<HTMLElement>('[data-active="true"]');
    if (typeof active?.scrollIntoView === 'function') active.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, items]);

  if (!mounted) return null;

  // Prefer below the caret; flip above when there is not room, and never cross an edge.
  const spaceBelow = window.innerHeight - anchor.bottom - OVERLAY_COLLISION_PADDING;
  const height = Math.min(MAX_HEIGHT, Math.max(items.length, 1) * 40 + 16);
  const placeAbove = spaceBelow < height && anchor.top > height + OVERLAY_COLLISION_PADDING;
  const top = placeAbove ? anchor.top - height - 4 : anchor.bottom + 4;
  const left = Math.min(
    Math.max(anchor.left, OVERLAY_COLLISION_PADDING),
    window.innerWidth - MENU_WIDTH - OVERLAY_COLLISION_PADDING,
  );

  return createPortal(
    <div
      data-suggestion-menu=""
      style={{ position: 'fixed', top, left, width: MENU_WIDTH, maxHeight: MAX_HEIGHT }}
      className="bg-surface-container-high text-on-surface border-outline-variant z-[120] overflow-y-auto rounded-lg border p-2 shadow-md"
    >
      <ul ref={listRef} id={listboxId} role="listbox" aria-label={ariaLabel} className="contents">
        {items.length === 0 ? (
          <li role="presentation" className="px-2 py-1.5">
            <Text token="body-small" tone="muted">
              {emptyText}
            </Text>
          </li>
        ) : (
          items.map((item, index) => {
            const Icon = item.icon;
            const active = index === activeIndex;
            return (
              <li
                key={item.id}
                id={`${listboxId}-${item.id}`}
                role="option"
                aria-selected={active}
                data-active={active}
                onMouseEnter={() => {
                  onActiveIndexChange(index);
                }}
                onMouseDown={(event) => {
                  // Keep the caret in the editor: a mousedown that stole focus would collapse
                  // the run before the click landed.
                  event.preventDefault();
                  onSelect(index);
                }}
                className={cn(
                  'flex min-h-9 cursor-pointer items-center gap-2 rounded-md px-2 py-1.5',
                  active ? 'bg-secondary-container text-on-secondary-container' : '',
                )}
              >
                <Icon aria-hidden className="size-4.5! shrink-0" />
                <span className="flex min-w-0 flex-col">
                  <Text token="body-medium" truncate>
                    {item.label}
                  </Text>
                  {item.hint ? (
                    <Text token="body-small" tone="muted" truncate>
                      {item.hint}
                    </Text>
                  ) : null}
                </span>
              </li>
            );
          })
        )}
      </ul>
    </div>,
    document.body,
  );
}
