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
import {
  MENU_METRICS,
  Text,
  type PopoverVirtualAnchor,
  VirtualMenuSurface,
} from '@docket/ui/primitives';
import { MenuListbox, MenuOption } from '@docket/ui/components';
import type { LucideIcon } from '@docket/ui/icons';
import { type JSX, useLayoutEffect, useRef } from 'react';

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

/**
 * Menu geometry. Width and max height are this menu's own — it positions itself against a caret
 * rather than an element, so Radix cannot measure them — but the row height comes from
 * {@link MENU_METRICS} so the height estimate below cannot drift from what actually renders. It
 * had: the estimate assumed 40px rows while the rows were 36px.
 */
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
  const virtualAnchor = useRef<PopoverVirtualAnchor | null>(null);
  virtualAnchor.current = { getBoundingClientRect: () => anchor };

  // Keep the highlighted row in view when the keyboard walks past the fold. Guarded because
  // scrolling is a layout operation and environments without layout (jsdom) do not implement it —
  // a missing scroll must never take the menu down with it.
  useLayoutEffect(() => {
    const active = listRef.current?.querySelector<HTMLElement>('[data-active="true"]');
    if (typeof active?.scrollIntoView === 'function') active.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, items]);

  const estimatedHeight = Math.min(
    MAX_HEIGHT,
    Math.max(items.length, 1) * MENU_METRICS.minHeightPx + MENU_METRICS.containerPaddingPx * 2,
  );

  return (
    <VirtualMenuSurface anchor={virtualAnchor} estimatedHeight={estimatedHeight} width="lg">
      <MenuListbox ref={listRef} id={listboxId} ariaLabel={ariaLabel}>
        {items.length === 0 ? (
          <li role="presentation" className="px-4 py-2">
            <Text token="body-small" tone="muted">
              {emptyText}
            </Text>
          </li>
        ) : (
          items.map((item, index) => {
            const Icon = item.icon;
            const active = index === activeIndex;
            return (
              <MenuOption
                key={item.id}
                id={`${listboxId}-${item.id}`}
                active={active}
                onActiveChange={() => {
                  onActiveIndexChange(index);
                }}
                onSelect={() => {
                  onSelect(index);
                }}
                leading={<Icon aria-hidden className="shrink-0" />}
                supporting={
                  item.hint ? (
                    <Text token="body-small" tone="muted" truncate>
                      {item.hint}
                    </Text>
                  ) : null
                }
              >
                <Text token="label-large" truncate>
                  {item.label}
                </Text>
              </MenuOption>
            );
          })
        )}
      </MenuListbox>
    </VirtualMenuSurface>
  );
}
