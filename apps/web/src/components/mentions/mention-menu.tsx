'use client';

/**
 * The floating `@` menu.
 *
 * @remarks
 * Anchored to the caret through a virtual popover anchor rather than to a trigger element, and it
 * must never take focus: the caret has to keep blinking in the prose while the user keeps typing
 * into it. `onOpenAutoFocus` being prevented is the single line that makes that true — without it
 * Radix moves focus and the whole interaction dies.
 *
 * Opens at `--dur-fast` rather than the `--dur-base` the palette uses. A modal should feel like it
 * arrived; an inline autocomplete that takes 180ms to appear just feels like lag.
 *
 * The pending Files group reserves its heading and two rows at the real row height from the moment
 * the external query starts. Results then replace skeletons in place, so the menu never grows
 * under the cursor and the popover never re-flips to the other side of the caret mid-typing.
 */
import { Popover, PopoverAnchor, PopoverContent, Skeleton } from '@docket/ui/primitives';
import type { PopoverVirtualAnchorRef } from '@docket/ui/primitives';
import { cn } from '@docket/ui/lib/utils';
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
  // The search lives here rather than in the controller so that a surface where nobody has typed
  // `@` mounts no query at all — and so a rich-text field stays usable outside a QueryClient.
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
        side="bottom"
        align="start"
        sideOffset={6}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
        }}
        className={cn(
          'w-[min(22rem,calc(100vw-2rem))] p-1.5',
          'max-h-[min(20rem,var(--radix-popover-content-available-height))] overflow-y-auto',
          'duration-(--dur-fast)',
        )}
      >
        <ul role="listbox" id={listboxId} aria-label="Mention a resource" className="space-y-0.5">
          {groups.map((group) => (
            <li key={group.key}>
              <p className="text-on-surface-variant px-3 pt-2 pb-1 text-xs font-medium">
                {group.label}
              </p>
              <ul className="space-y-0.5">
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
            </li>
          ))}

          {externalPending ? (
            <li aria-hidden>
              <p className="text-on-surface-variant px-3 pt-2 pb-1 text-xs font-medium">
                Files
                <span className="ml-1 opacity-70">searching…</span>
              </p>
              <div className="space-y-0.5 px-3">
                <Skeleton className="h-9 rounded-md" />
                <Skeleton className="h-9 rounded-md" />
              </div>
            </li>
          ) : null}

          {externalFailed && !externalPending ? (
            <li>
              <p className="text-on-surface-variant px-3 pt-2 pb-1 text-xs font-medium">
                Files <span className="opacity-70">· unavailable</span>
              </p>
            </li>
          ) : null}

          {nothingYet && localPending ? (
            <li aria-hidden className="space-y-0.5 px-3 py-1">
              <Skeleton className="h-9 rounded-md" />
              <Skeleton className="h-9 rounded-md" />
              <Skeleton className="h-9 rounded-md" />
            </li>
          ) : null}

          {nothingYet && !localPending && !localFailed ? (
            <li className="text-on-surface-variant text-body-medium px-3 py-6 text-center">
              {query.trim() === ''
                ? 'Nothing to reference yet'
                : `No matches for “${query.trim()}”`}
            </li>
          ) : null}

          {localFailed ? (
            <li
              role="alert"
              className="text-destructive bg-destructive/5 border-destructive/30 text-body-medium m-1 rounded-md border px-3 py-2"
            >
              Could not search this workspace.
            </li>
          ) : null}
        </ul>

        <p
          aria-live="polite"
          aria-atomic="true"
          className="sr-only"
        >{`${state.items.length} results`}</p>
      </PopoverContent>
    </Popover>
  );
}
