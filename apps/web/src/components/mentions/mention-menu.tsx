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
 * Group headings let readers skip to the kind they need without scanning every row.
 *
 * ARIA shape: the listbox's children are `role="group"`, each labelled by its own heading, and only
 * the rows carry `role="option"`. A listbox whose direct children are neither is malformed, and a
 * screen reader then reports the wrong option count — which is exactly the number a user relies on
 * to know how far the list goes.
 *
 * The pending Files group reserves its heading and two rows at the real row height, so results
 * replace skeletons in place and the popover never re-flips position mid-typing.
 */
import { MenuListbox, MenuNote, MenuSectionLabel, MenuOption } from '@docket/ui/components';
import { Popover, PopoverAnchor, PopoverContent, Skeleton } from '@docket/ui/primitives';
import type { PopoverVirtualAnchorRef } from '@docket/ui/primitives';
import { useEffect, useRef, useMemo } from 'react';
import type { MentionChoice } from './mention-choice';
import { useMentionPersonCreation } from './use-mention-person-creation';

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
  readonly onSelect: (item: MentionChoice) => void;
  readonly onOpenChange: (open: boolean) => void;
  readonly onRows: (items: readonly MentionChoice[], resolvedActiveKey: string | undefined) => void;
}

/** Row id for a given item, so `aria-activedescendant` can point at it. */
export function mentionRowId(listboxId: string, item: { readonly id: string }): string {
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
  const { groups } = state;

  const creation = useMentionPersonCreation(
    orgId,
    query,
    onSelect,
    hasExactPersonMatch(state.items, query),
  );
  const items = useMemo<readonly MentionChoice[]>(
    () =>
      creation.confirming ? [] : [...state.items, ...(creation.choice ? [creation.choice] : [])],
    [state.items, creation.choice, creation.confirming],
  );
  const previousItems = useRef<readonly MentionChoice[]>([]);
  const resolvedActiveKey = resolveActiveKey({
    items,
    activeKey,
    hasArrowed,
    previousItems: previousItems.current,
  });
  previousItems.current = items;
  const activeItem = items.find((item) => item.id === resolvedActiveKey);
  const activeRowId = activeItem ? mentionRowId(listboxId, activeItem) : undefined;
  useEffect(() => {
    if (activeRowId) document.getElementById(activeRowId)?.scrollIntoView({ block: 'nearest' });
  }, [activeRowId]);

  useEffect(() => {
    onRows(items, resolvedActiveKey);
  }, [onRows, items, resolvedActiveKey]);

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (!next && creation.confirming) creation.cancel();
        else onOpenChange(next);
      }}
    >
      <PopoverAnchor virtualRef={anchorRef} />
      <PopoverContent
        data-mention-menu="true"
        presentation="menu"
        width="xl"
        side="bottom"
        align="start"
        sideOffset={6}
        onEscapeKeyDown={(event) => {
          if (creation.confirming) {
            event.preventDefault();
            event.stopPropagation();
            creation.cancel();
          }
        }}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
        }}
      >
        {creation.confirmation}
        {!creation.confirming ? (
          <MenuListbox id={listboxId} ariaLabel="Mention a resource">
            {groups.map((group) => (
              <li key={group.key} role="group" aria-labelledby={`${listboxId}-group-${group.key}`}>
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
              </li>
            ))}

            <MentionSearchStatus state={state} query={query} />
            {creation.choice ? (
              <MenuOption
                id={mentionRowId(listboxId, creation.choice)}
                active={creation.choice.id === resolvedActiveKey}
                onSelect={() => {
                  if (creation.choice) onSelect(creation.choice);
                }}
              >
                {creation.choice.title}
              </MenuOption>
            ) : null}
          </MenuListbox>
        ) : null}

        <p aria-live="polite" aria-atomic="true" className="sr-only">
          {`${state.items.length} results`}
        </p>
      </PopoverContent>
    </Popover>
  );
}

function MentionSearchStatus({
  state,
  query,
}: {
  state: ReturnType<typeof useMentionSearch>;
  query: string;
}): React.JSX.Element {
  const { groups, localPending, externalPending, localFailed, externalFailed } = state;
  const nothingYet = groups.length === 0;
  return (
    <>
      {' '}
      {externalPending || externalFailed ? (
        <li aria-hidden role="presentation">
          <MenuSectionLabel as="p">
            Files
            {externalPending ? <span className="ml-1 opacity-70">searching…</span> : null}
          </MenuSectionLabel>
          {externalPending ? (
            <div className="space-y-0.5 px-1">
              <Skeleton className="h-10 rounded-md" />
              <Skeleton className="h-10 rounded-md" />
            </div>
          ) : (
            <MenuNote>File search is unavailable.</MenuNote>
          )}
        </li>
      ) : null}
      {nothingYet && !localPending && !localFailed ? (
        <li
          role="presentation"
          className="text-on-surface-variant text-body-small px-4 py-6 text-center"
        >
          {query.trim() === '' ? 'Nothing to reference yet' : `No matches for “${query.trim()}”`}
        </li>
      ) : null}
      {nothingYet && localPending ? (
        <li aria-hidden className="space-y-0.5 px-1 py-1">
          <Skeleton className="h-10 rounded-md" />
          <Skeleton className="h-10 rounded-md" />
          <Skeleton className="h-10 rounded-md" />
        </li>
      ) : null}
      {nothingYet && localFailed ? (
        <li
          role="presentation"
          className="text-on-surface-variant text-body-small px-4 py-6 text-center"
        >
          Search is unavailable.
        </li>
      ) : null}
    </>
  );
}

function hasExactPersonMatch(items: readonly MentionChoice[], query: string): boolean {
  return items.some(
    (item) =>
      item.origin === 'local' &&
      item.entityKind === 'actor' &&
      item.title.toLocaleLowerCase() === query.trim().toLocaleLowerCase(),
  );
}
