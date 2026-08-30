'use client';

/**
 * The floating `@` menu.
 *
 * @remarks
 * Anchored to the caret through a virtual popover anchor, and never takes focus — the caret keeps
 * blinking in the prose while the user types. Preventing `onOpenAutoFocus` is what makes that
 * work; without it Radix moves focus away from the document.
 *
 * Opens at `--dur-fast` rather than the palette's `--dur-base`, since an inline autocomplete that
 * takes 180ms to appear reads as lag.
 *
 * Groups are separated by a tonal rule as well as a heading, so the eye can skip a whole kind at
 * once instead of reading every row to find where one section ends.
 *
 * ARIA shape: the listbox's children are `role="group"`, each labelled by its own heading, and only
 * the rows carry `role="option"`. A listbox whose direct children are neither is malformed, and a
 * screen reader then reports the wrong option count — which is exactly the number a user relies on
 * to know how far the list goes.
 *
 * The pending Files group reserves its heading and two rows at the real row height, so results
 * replace skeletons in place and the popover never re-flips position mid-typing.
 */
import { MenuDivider, MenuListbox, MenuSectionLabel } from '@docket/ui/components';
import {
  Popover,
  PopoverAnchor,
  PopoverBody,
  PopoverContent,
  Skeleton,
} from '@docket/ui/primitives';
import type { PopoverVirtualAnchorRef } from '@docket/ui/primitives';
import type { MentionItem } from '@docket/types';
import { useEffect, useRef } from 'react';

import MentionRow from './mention-row';
import { resolveActiveKey } from './mention-merge';
import { useMentionSearch } from './use-mention-search';

/** Props for {@link MentionMenu}. */
export interface MentionMenuProps {
  readonly open: boolean;
  readonly orgId: string;
  readonly anchorRef: PopoverVirtualAnchorRef;
  /** The row the user arrowed to; resolved here against the rows that currently exist. */
  readonly activeKey: string | undefined;
  readonly hasArrowed: boolean;
  readonly listboxId: string;
  readonly query: string;
  readonly onSelect: (item: MentionItem) => void;
  readonly onOpenChange: (open: boolean) => void;
  readonly onRows: (items: readonly MentionItem[], resolvedActiveKey: string | undefined) => void;
}

/** Shared heading treatment for every section of the menu — the menu section label, verbatim. */
/** Row id for a given item, so `aria-activedescendant` can point at it. */
export function mentionRowId(listboxId: string, item: MentionItem): string {
  return `${listboxId}-${item.id.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
}

/**
 * Render the mention menu.
 *
 * @returns The popover, or an empty fragment when there is nothing worth showing.
 */
export default function MentionMenu({
  open,
  orgId,
  anchorRef,
  activeKey,
  hasArrowed,
  listboxId,
  query,
  onSelect,
  onOpenChange,
  onRows,
}: MentionMenuProps): React.JSX.Element {
  // Here rather than in the controller so a surface where nobody typed `@` mounts no query, and a
  // rich-text field stays usable outside a QueryClient.
  const state = useMentionSearch({ orgId, query, enabled: open });
  const { groups, localPending, externalPending, localFailed, externalFailed } = state;
  const nothingYet = groups.length === 0;

  const previousItems = useRef<readonly MentionItem[]>([]);
  const resolvedActiveKey = resolveActiveKey({
    items: state.items,
    activeKey,
    hasArrowed,
    previousItems: previousItems.current,
  });
  previousItems.current = state.items;

  useEffect(() => {
    onRows(state.items, resolvedActiveKey);
  }, [onRows, state.items, resolvedActiveKey]);

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverAnchor virtualRef={anchorRef} />
      <PopoverContent
        presentation="panel"
        width="wide"
        side="bottom"
        align="start"
        sideOffset={6}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
        }}
      >
        <PopoverBody inset="none">
          <MenuListbox id={listboxId} ariaLabel="Mention a resource" className="space-y-0.5">
            {groups.map((group, index) => (
              <li key={group.key} role="group" aria-labelledby={`${listboxId}-group-${group.key}`}>
                {index > 0 ? <MenuDivider as="div" aria-hidden className="mb-2" /> : null}
                <MenuSectionLabel as="p" id={`${listboxId}-group-${group.key}`}>
                  {group.label}
                </MenuSectionLabel>
                <ul className="space-y-0.5" role="presentation">
                  {group.items.map((item) => (
                    <MentionRow
                      key={item.id}
                      id={mentionRowId(listboxId, item)}
                      item={item}
                      active={item.id === resolvedActiveKey}
                      onSelect={onSelect}
                    />
                  ))}
                </ul>
                {group.hidden > 0 ? (
                  <p className="text-on-surface-variant px-2 pt-1 pb-0.5 text-xs">
                    {`+${group.hidden} more — keep typing to narrow`}
                  </p>
                ) : null}
              </li>
            ))}

            {externalPending || externalFailed ? (
              <li aria-hidden role="presentation">
                {groups.length > 0 ? <MenuDivider as="div" aria-hidden className="mb-2" /> : null}
                <MenuSectionLabel as="p">
                  Files
                  {externalPending ? <span className="ml-1 opacity-70">searching…</span> : null}
                </MenuSectionLabel>
                {externalPending ? (
                  <div className="space-y-0.5 px-2">
                    <Skeleton className="h-10 rounded-md" />
                    <Skeleton className="h-10 rounded-md" />
                  </div>
                ) : (
                  <p className="text-on-surface-variant px-3 py-2 text-sm">
                    File search is unavailable.
                  </p>
                )}
              </li>
            ) : null}

            {nothingYet && !localPending && !localFailed ? (
              <li
                role="presentation"
                className="text-on-surface-variant text-body-medium px-3 py-6 text-center"
              >
                {query.trim() === ''
                  ? 'Nothing to reference yet'
                  : `No matches for “${query.trim()}”`}
              </li>
            ) : null}

            {nothingYet && localPending ? (
              <li aria-hidden className="space-y-0.5 px-3 py-1">
                <Skeleton className="h-10 rounded-md" />
                <Skeleton className="h-10 rounded-md" />
                <Skeleton className="h-10 rounded-md" />
              </li>
            ) : null}

            {nothingYet && localFailed ? (
              <li
                role="presentation"
                className="text-on-surface-variant text-body-medium px-3 py-6 text-center"
              >
                Search is unavailable.
              </li>
            ) : null}
          </MenuListbox>

          <p aria-live="polite" aria-atomic="true" className="sr-only">
            {`${state.items.length} results`}
          </p>
        </PopoverBody>
      </PopoverContent>
    </Popover>
  );
}
