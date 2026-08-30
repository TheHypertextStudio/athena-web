'use client';

/**
 * One kind of work's status set, with every category shown.
 *
 * @remarks
 * Four sections on one page rather than four tabs. There are about twenty rows in total, so tabs
 * would hide three-quarters of the model behind a click for no density gain — and the point of the
 * page is that all four sets share one taxonomy, which you can only see by seeing them together.
 *
 * The team selector appears on the Task section alone, because Tasks are the only work a team
 * owns. It stays hidden in a personal workspace, and in a workspace with a single team, where
 * forking away from a set nobody else holds would mean nothing.
 */
import type { WorkStatusCategory, WorkStatusEntityType } from '@docket/types';
import { WORK_STATUS_CATEGORIES } from '@docket/types';
import { ChevronDown } from '@docket/ui/icons';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@docket/ui/primitives';
import type { JSX, ReactNode } from 'react';

import { StatusCategoryGroup } from './status-category-group';
import type { StatusLike } from './status-registry';

/** One team the Task set can be scoped to. */
export interface TeamChoice {
  readonly id: string;
  readonly name: string;
  readonly forked: boolean;
}

/** Props for {@link StatusEntitySection}. */
export interface StatusEntitySectionProps {
  /** Which kind of work this section covers. */
  entityType: WorkStatusEntityType;
  /** The section heading — the workspace's own word for this kind of work. */
  title: string;
  /** One line on what this set governs. */
  description: string;
  /** The set, in board order. */
  statuses: readonly StatusLike[];
  /** Whether the viewer may reshape this workspace's statuses. */
  canManage: boolean;
  /** The teams that can hold their own Task statuses; empty hides the selector. */
  teams?: readonly TeamChoice[] | undefined;
  /** The team currently in view, or null for the workspace set. */
  scopeTeamId?: string | null | undefined;
  /** Whether the team in view keeps its own set. */
  scopeForked?: boolean | undefined;
  /** Look at another team's set, or the workspace's. */
  onScopeChange?: ((teamId: string | null) => void) | undefined;
  /** Give the team in view its own copy of the workspace set. */
  onFork?: (() => void) | undefined;
  /** Return the team in view to the workspace set. */
  onReset?: (() => void) | undefined;
  /** Add a status to a category. */
  onAdd: (category: WorkStatusCategory) => void;
  /** Open the editor on a status. */
  onEdit: (status: StatusLike) => void;
  /** Make a status the one new work starts in. */
  onMakeDefault: (status: StatusLike) => void;
  /** Delete a status, choosing where its work goes. */
  onDelete: (status: StatusLike) => void;
  /** Commit a new order within one category. */
  onReorder: (category: WorkStatusCategory, statusId: string, toIndex: number) => void;
  /** Render a status's decorative identity beside its semantic category icon. */
  renderIdentity?: (status: StatusLike) => ReactNode;
}

/**
 * Why a status cannot be deleted, keyed by id.
 *
 * @remarks
 * Computed here rather than discovered from a rejected request, so the menu can say what is in the
 * way before anyone tries. These mirror the invariants the API enforces in its transaction: a set
 * keeps somewhere to finish, somewhere to abandon, somewhere for live work, and a place new work
 * starts.
 */
function deleteBlockers(statuses: readonly StatusLike[]): ReadonlyMap<string, string> {
  const blocked = new Map<string, string>();
  const countIn = (test: (status: StatusLike) => boolean): number => statuses.filter(test).length;
  for (const status of statuses) {
    if (status.isDefault) {
      blocked.set(status.id, 'New work starts here. Make another status the default first.');
    } else if (
      status.category === 'completed' &&
      countIn((s) => s.category === 'completed') === 1
    ) {
      blocked.set(status.id, 'This is the only way to finish work here.');
    } else if (status.category === 'canceled' && countIn((s) => s.category === 'canceled') === 1) {
      blocked.set(status.id, 'This is the only way to abandon work here.');
    } else if (
      status.category !== 'completed' &&
      status.category !== 'canceled' &&
      countIn((s) => s.category !== 'completed' && s.category !== 'canceled') === 1
    ) {
      blocked.set(status.id, 'This is the only status for work that has not ended.');
    }
  }
  return blocked;
}

/**
 * Render one kind of work's statuses, category by category.
 *
 * @param props - The set and everything the viewer may do with it.
 * @returns the section element.
 */
export function StatusEntitySection({
  entityType,
  title,
  description,
  statuses,
  canManage,
  teams = [],
  scopeTeamId = null,
  scopeForked = false,
  onScopeChange,
  onFork,
  onReset,
  onAdd,
  onEdit,
  onMakeDefault,
  onDelete,
  onReorder,
  renderIdentity,
}: StatusEntitySectionProps): JSX.Element {
  const inherited = scopeTeamId !== null && !scopeForked;
  const blocked = deleteBlockers(statuses);
  const scopeName =
    scopeTeamId === null
      ? 'Workspace default'
      : (teams.find((team) => team.id === scopeTeamId)?.name ?? 'Team');

  return (
    <section className="flex min-w-0 flex-col gap-4" aria-labelledby={`statuses-${entityType}`}>
      <div className="flex min-w-0 items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col">
          <h3 id={`statuses-${entityType}`} className="text-on-surface text-title-medium">
            {title}
          </h3>
          <p className="text-on-surface-variant text-body-small">{description}</p>
        </div>

        {teams.length > 0 && onScopeChange !== undefined ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="outline" size="sm">
                {scopeName}
                <ChevronDown />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onSelect={() => {
                  onScopeChange(null);
                }}
              >
                Workspace default
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Teams</DropdownMenuLabel>
              {teams.map((team) => (
                <DropdownMenuItem
                  key={team.id}
                  onSelect={() => {
                    onScopeChange(team.id);
                  }}
                >
                  {team.name}
                  {team.forked ? (
                    <span className="text-on-surface-variant ml-2">Customized</span>
                  ) : null}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>

      {inherited ? (
        <div className="bg-surface-container-low flex items-center justify-between gap-4 rounded-lg px-3 py-2.5">
          <p className="text-on-surface-variant text-body-small">
            This team uses the workspace statuses.
          </p>
          {canManage && onFork !== undefined ? (
            <Button type="button" variant="outline" size="sm" onClick={onFork}>
              Customize for this team
            </Button>
          ) : null}
        </div>
      ) : null}

      {scopeForked && canManage && onReset !== undefined ? (
        <div className="bg-surface-container-low flex items-center justify-between gap-4 rounded-lg px-3 py-2.5">
          <p className="text-on-surface-variant text-body-small">
            This team keeps its own statuses.
          </p>
          <Button type="button" variant="ghost" size="sm" onClick={onReset}>
            Reset to workspace default
          </Button>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-col gap-5">
        {WORK_STATUS_CATEGORIES.map((category) => (
          <StatusCategoryGroup
            key={category}
            category={category}
            statuses={statuses.filter((status) => status.category === category)}
            canManage={canManage}
            readOnly={inherited}
            onAdd={() => {
              onAdd(category);
            }}
            onEdit={onEdit}
            onMakeDefault={onMakeDefault}
            onDelete={onDelete}
            onReorder={(statusId, toIndex) => {
              onReorder(category, statusId, toIndex);
            }}
            deleteBlocked={blocked}
            {...(renderIdentity ? { renderIdentity } : {})}
          />
        ))}
      </div>
    </section>
  );
}
