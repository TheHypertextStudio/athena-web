'use client';

/**
 * One category's statuses, in the order they read.
 *
 * @remarks
 * Every category is rendered whether or not the workspace put anything in it, because the empty
 * slot is the affordance: a workspace that has never had a "waiting on someone else" column finds
 * out it could, by seeing the gap and the button in it.
 *
 * Reordering is scoped to this component, which is what confines a drag to its own category. That
 * is the mechanical form of the rule — the categories keep a fixed order, and a status moves only
 * among the ones it behaves like — so a move can never produce a set the API would reject.
 */
import type { WorkStatusCategory } from '@docket/work/work-status-contract';
import { useReorderable } from '@docket/ui/hooks';
import { Plus } from '@docket/ui/icons';
import { Button } from '@docket/ui/primitives';
import type { JSX, ReactNode } from 'react';

import { CATEGORY_DESCRIPTION, CATEGORY_LABEL } from '@/lib/work-category';

import { StatusSettingsRow } from './status-settings-row';
import type { StatusLike } from './status-registry';

/** Props for {@link StatusCategoryGroup}. */
export interface StatusCategoryGroupProps {
  /** The category this group covers. */
  category: WorkStatusCategory;
  /** The statuses in it, in order. */
  statuses: readonly StatusLike[];
  /** Whether the viewer may reshape this workspace's statuses. */
  canManage: boolean;
  /** Whether this set is inherited and shown for reference only. */
  readOnly?: boolean | undefined;
  /** Add a status to this category. */
  onAdd: () => void;
  /** Open the editor on a status. */
  onEdit: (status: StatusLike) => void;
  /** Make a status the one new work starts in. */
  onMakeDefault: (status: StatusLike) => void;
  /** Delete a status, choosing where its work goes. */
  onDelete: (status: StatusLike) => void;
  /** Commit a new order for this category. */
  onReorder: (statusId: string, toIndex: number) => void;
  /** Why a status here cannot be deleted, keyed by status id. */
  deleteBlocked: ReadonlyMap<string, string>;
  /** Render the decorative identity control beside a status's semantic category icon. */
  renderIdentity?: (status: StatusLike) => ReactNode;
}

/**
 * Render one category and the statuses filed under it.
 *
 * @param props - The category, its statuses, and what the viewer may do with them.
 * @returns the group element.
 */
export function StatusCategoryGroup({
  category,
  statuses,
  canManage,
  readOnly = false,
  onAdd,
  onEdit,
  onMakeDefault,
  onDelete,
  onReorder,
  deleteBlocked,
  renderIdentity,
}: StatusCategoryGroupProps): JSX.Element {
  const reorderable = canManage && !readOnly && statuses.length > 1;
  const reorder = useReorderable({
    itemIds: statuses.map((status) => status.id),
    onReorder,
    describeItem: (id) => statuses.find((status) => status.id === id)?.name ?? 'Status',
    disabled: !reorderable,
  });

  return (
    <section className="flex min-w-0 flex-col gap-2">
      <header className="flex min-w-0 items-baseline gap-2 px-3">
        <h4 className="text-on-surface-variant text-label-large shrink-0">
          {CATEGORY_LABEL[category]}
        </h4>
      </header>

      {statuses.length === 0 ? (
        <div className="bg-surface-container-low text-on-surface-variant text-body-small flex min-w-0 items-center justify-between gap-3 rounded-lg px-3 py-2.5">
          <span className="min-w-0 truncate">{CATEGORY_DESCRIPTION[category]}</span>
          {canManage && !readOnly ? (
            <Button type="button" variant="ghost" size="sm" onClick={onAdd}>
              <Plus />
              Add
            </Button>
          ) : null}
        </div>
      ) : (
        <>
          <ul className="flex flex-col gap-1">
            {statuses.map((status) => (
              <StatusSettingsRow
                key={status.id === '' ? status.key : status.id}
                status={status}
                category={category}
                canManage={canManage}
                readOnly={readOnly}
                reorder={reorderable ? reorder : undefined}
                {...(renderIdentity ? { identity: renderIdentity(status) } : {})}
                onEdit={() => {
                  onEdit(status);
                }}
                onMakeDefault={() => {
                  onMakeDefault(status);
                }}
                onDelete={() => {
                  onDelete(status);
                }}
                deleteBlockedReason={deleteBlocked.get(status.id)}
              />
            ))}
          </ul>
          {canManage && !readOnly ? (
            <div className="px-3">
              <Button type="button" variant="ghost" size="sm" onClick={onAdd}>
                <Plus />
                Add status
              </Button>
            </div>
          ) : null}
        </>
      )}

      {/* The keyboard path announces every move; without this it would be silent. */}
      <span aria-live="polite" className="sr-only">
        {reorder.liveMessage}
      </span>
    </section>
  );
}
