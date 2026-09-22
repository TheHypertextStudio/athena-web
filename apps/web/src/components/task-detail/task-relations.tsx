'use client';

/**
 * The task's links to other tasks: what blocks it, what it blocks, and what is related to it.
 *
 * @remarks
 * One section with up to three groups. The heading's `+` opens a menu of the three links; choosing
 * one opens a task search anchored to the same button, which never offers this task or a task
 * already linked to it. An empty group is not shown, and a task with no links shows the heading
 * and its `+` alone. Every row removes its link (never the other task) and names its project only
 * when that differs from this task's.
 */
import type { TaskRef } from '@docket/work/task-model';
import { Plus } from '@docket/ui/icons';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@docket/ui/primitives';
import { type JSX, useMemo, useRef, useState } from 'react';

import { DetailSection } from '@/components/entity-detail/detail-section';
import type { DependencyDirection } from '@/lib/use-task-relations';

import { type TaskRelationCommand, useTaskRelationCommands } from './task-relation-commands';
import { TaskRelationRow } from './task-relation-row';
import { TaskSearchPopover } from './task-search-popover';

/** The three kinds of link, in the order the section lists them. */
export type TaskRelationKind = DependencyDirection | 'related';

/** How each kind reads in the menu, the group label, the picker, and the remove button. */
const KIND_COPY: Readonly<
  Record<
    TaskRelationKind,
    { menu: string; group: string; search: string; picker: string; remove: string }
  >
> = {
  blockedBy: {
    menu: 'Add blocker',
    group: 'Blocked by',
    search: 'Find the task this one waits on…',
    picker: 'Task that blocks this one',
    remove: 'Remove blocker',
  },
  blocking: {
    menu: 'Add blocked task',
    group: 'Blocking',
    search: 'Find a task this one blocks…',
    picker: 'Task this one blocks',
    remove: 'Remove blocked task',
  },
  related: {
    menu: 'Add related task',
    group: 'Related',
    search: 'Find a related task…',
    picker: 'Related task',
    remove: 'Remove related task',
  },
};

const KINDS: readonly TaskRelationKind[] = ['blockedBy', 'blocking', 'related'];

/** Props for {@link TaskRelations}. */
export interface TaskRelationsProps {
  readonly orgId: string;
  /** The task the section belongs to; never offered as its own link. */
  readonly taskId: string;
  /** This task's project, so a row names a project only when it differs. */
  readonly projectId: string | null;
  readonly blockedBy: readonly TaskRef[];
  readonly blocking: readonly TaskRef[];
  readonly related: readonly TaskRef[];
  readonly projectName: (projectId: string) => string;
  readonly canEdit: boolean;
  readonly onAdd: (kind: TaskRelationKind, task: TaskRef) => void;
  readonly onRemove: (kind: TaskRelationKind, taskId: string) => void;
  readonly onOpen: (taskId: string) => void;
  readonly onRename?: ((taskId: string, title: string) => void) | undefined;
}

/** Narrow the page's open control to the kind of link this section adds, if it is one. */
function relationKindOf(command: TaskRelationCommand | null): TaskRelationKind | null {
  return command !== null && (KINDS as readonly string[]).includes(command)
    ? (command as TaskRelationKind)
    : null;
}

/**
 * Render the Relations section.
 *
 * @param props - See {@link TaskRelationsProps}.
 * @returns the section.
 */
export function TaskRelations(props: TaskRelationsProps): JSX.Element {
  const { blockedBy, blocking, related } = props;
  const lists = useMemo<RelationLists>(
    () => ({ blockedBy, blocking, related }),
    [blockedBy, blocking, related],
  );
  const total = blockedBy.length + blocking.length + related.length;
  return (
    <DetailSection
      id="relations"
      title="Relations"
      count={total > 0 ? total : undefined}
      actions={props.canEdit ? <AddRelation {...props} lists={lists} /> : null}
    >
      {total > 0 ? (
        <div className="flex flex-col gap-3">
          {KINDS.filter((kind) => lists[kind].length > 0).map((kind) => (
            <RelationGroup key={kind} kind={kind} tasks={lists[kind]} {...props} />
          ))}
        </div>
      ) : null}
    </DetailSection>
  );
}

/** The task's links, by kind. */
type RelationLists = Readonly<Record<TaskRelationKind, readonly TaskRef[]>>;

/** Props for {@link AddRelation}. */
interface AddRelationProps extends TaskRelationsProps {
  readonly lists: RelationLists;
}

/**
 * The heading's `+`: a menu of the three links, each opening a task search from the same button.
 *
 * @param props - See {@link AddRelationProps}.
 * @returns the menu button inside its search popover.
 */
function AddRelation({ orgId, taskId, projectId, lists, ...props }: AddRelationProps): JSX.Element {
  const commands = useTaskRelationCommands();
  const requestedKind = relationKindOf(commands.active);
  const [menuOpen, setMenuOpen] = useState(false);
  const picked = useRef<TaskRelationKind | null>(null);
  // A task already linked in any way is never offered again: linking a blocker as a blocked task
  // would be a loop, and one link per pair keeps the section readable.
  const exclude = useMemo(
    () => new Set([taskId, ...KINDS.flatMap((kind) => lists[kind].map((ref) => ref.id))]),
    [lists, taskId],
  );
  const copy = requestedKind === null ? null : KIND_COPY[requestedKind];
  return (
    <TaskSearchPopover
      orgId={orgId}
      open={requestedKind !== null}
      onOpenChange={(open) => {
        if (!open && requestedKind !== null) commands.setActive(null);
      }}
      anchor="anchor"
      exclude={exclude}
      onPick={(task) => {
        if (requestedKind !== null) props.onAdd(requestedKind, task);
      }}
      projectName={(id) => (id === projectId ? null : props.projectName(id))}
      searchPlaceholder={copy?.search ?? ''}
      ariaLabel={copy?.picker ?? 'Task'}
    >
      <span className="inline-flex">
        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="ghost" size="sm" iconOnly aria-label="Add relation">
              <Plus className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            onCloseAutoFocus={(event) => {
              // The search opens only once the menu has fully unmounted: while it animates out,
              // the menu still takes focus on pointer movement, which the search would read as
              // focus leaving it and close. Focus stays put for the search to claim.
              const kind = picked.current;
              if (kind === null) return;
              event.preventDefault();
              picked.current = null;
              commands.setActive(kind);
            }}
          >
            {KINDS.map((kind) => (
              <DropdownMenuItem
                key={kind}
                onSelect={() => {
                  picked.current = kind;
                }}
              >
                {KIND_COPY[kind].menu}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </span>
    </TaskSearchPopover>
  );
}

/** Props for {@link RelationGroup}. */
interface RelationGroupProps extends TaskRelationsProps {
  readonly kind: TaskRelationKind;
  readonly tasks: readonly TaskRef[];
}

/**
 * One kind of link: its label, then a row per linked task.
 *
 * @param props - See {@link RelationGroupProps}.
 * @returns the labelled group.
 */
function RelationGroup({
  kind,
  tasks,
  orgId,
  projectId,
  canEdit,
  ...props
}: RelationGroupProps): JSX.Element {
  const hintFor = (ref: TaskRef): string | null =>
    ref.projectId && ref.projectId !== projectId ? props.projectName(ref.projectId) : null;
  return (
    <div role="group" aria-label={KIND_COPY[kind].group} className="flex flex-col">
      <h3 className="text-on-surface-variant text-label-medium flex h-7 items-center px-2">
        {KIND_COPY[kind].group}
      </h3>
      <ul className="flex flex-col">
        {tasks.map((ref) => (
          <TaskRelationRow
            key={ref.id}
            orgId={orgId}
            task={ref}
            hint={hintFor(ref)}
            onOpen={props.onOpen}
            onRename={canEdit ? props.onRename : undefined}
            onRemove={
              canEdit
                ? () => {
                    props.onRemove(kind, ref.id);
                  }
                : undefined
            }
            removeLabel={KIND_COPY[kind].remove}
          />
        ))}
      </ul>
    </div>
  );
}
