'use client';

/**
 * `work-views/work-list-more-column` — the roster's trailing ⋯, which opens a row's action menu.
 *
 * @remarks
 * The roster's actions otherwise open only on right-click, Shift+F10, or the Menu key, so on a
 * phone they were unreachable. The ⋯ raises the same object menu ({@link ObjectMoreButton}). A row
 * that is not an actionable object (it carries no object target) gets no button, since the menu
 * would have nothing to open on.
 */
import type { Column } from '@docket/ui/components';
import type { ViewTarget } from '@docket/work/view-contract';

import { ObjectMoreButton } from '@/components/context-menu';

import { workViewRowTitle } from './renderer-types';
import type { ListMembership } from './work-list-groups';

/**
 * Append the ⋯ column to a roster's columns.
 *
 * @param columns - The roster's columns.
 * @param hasObject - Whether a membership's row is an object the menu can act on.
 * @returns the same columns with a trailing ⋯ column.
 */
export function withWorkListMoreColumn<TTarget extends ViewTarget>(
  columns: readonly Column<ListMembership<TTarget>>[],
  hasObject: (membership: ListMembership<TTarget>) => boolean,
): readonly Column<ListMembership<TTarget>>[] {
  return [
    ...columns,
    {
      key: 'more',
      header: '',
      width: '2rem',
      priority: 'always',
      render: (membership) =>
        hasObject(membership) ? (
          <ObjectMoreButton title={workViewRowTitle(membership.row)} />
        ) : null,
    },
  ];
}
