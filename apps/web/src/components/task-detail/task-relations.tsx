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
import type { TaskDetail, TaskRef } from '@docket/work/task-model';
import { Plus } from '@docket/ui/icons';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@docket/ui/primitives';
import { type JSX, useRef } from 'react';

import { DetailSection } from '@/components/entity-detail/detail-section';
import { SegmentedList } from '@/components/entity-detail/segmented-list';
import type { TaskLink } from '@/lib/use-task-relations';

import { LINK_COPY, useTaskRelationControls } from './task-relation-commands';
import { TaskRelationRow } from './task-relation-row';
import { TaskSearchPopover } from './task-search-popover';

/** The three kinds of link this section lists, in order. */
const KINDS = ['blockedBy', 'blocking', 'related'] as const satisfies readonly TaskLink[];

/** A kind of link this section lists. */
type SectionLink = (typeof KINDS)[number];

/** The tasks linked as `kind`. */
function linkedAs(task: TaskDetail, kind: SectionLink): readonly TaskRef[] {
  if (kind === 'related') return task.relatedTasks;
  return task[kind];
}

/** Names a linked task's project when it differs from this task's, else `null`. */
type OtherProjectName = (projectId: string) => string | null;

/** Props for {@link TaskRelations}. */
export interface TaskRelationsProps {
  readonly task: TaskDetail;
  /** Name a project for a linked task that sits in a different one. */
  readonly projectName: (projectId: string) => string;
  readonly canEdit: boolean;
}

/**
 * Render the Relations section.
 *
 * @param props - See {@link TaskRelationsProps}.
 * @returns the section.
 */
export function TaskRelations({ task, projectName, canEdit }: TaskRelationsProps): JSX.Element {
  const shown = KINDS.filter((kind) => linkedAs(task, kind).length > 0);
  const total = shown.reduce((sum, kind) => sum + linkedAs(task, kind).length, 0);
  const otherProject: OtherProjectName = (projectId) =>
    projectId === task.projectId ? null : projectName(projectId);
  return (
    <DetailSection
      id="relations"
      title="Relations"
      count={total > 0 ? total : undefined}
      actions={canEdit ? <AddRelation task={task} otherProject={otherProject} /> : null}
    >
      {shown.length > 0 ? (
        <div className="flex flex-col gap-4">
          {shown.map((kind) => (
            <RelationGroup
              key={kind}
              kind={kind}
              task={task}
              otherProject={otherProject}
              canEdit={canEdit}
            />
          ))}
        </div>
      ) : null}
    </DetailSection>
  );
}

/** Props for {@link AddRelation}. */
interface AddRelationProps {
  readonly task: TaskDetail;
  readonly otherProject: OtherProjectName;
}

/**
 * The heading's `+`: a menu of the three links, each opening a task search from the same button.
 *
 * @param props - See {@link AddRelationProps}.
 * @returns the menu button inside its search popover.
 */
function AddRelation({ task, otherProject }: AddRelationProps): JSX.Element {
  const { setActive } = useTaskRelationControls();
  const picked = useRef<SectionLink | null>(null);
  return (
    <TaskSearchPopover task={task} links={KINDS} anchor="anchor" projectName={otherProject}>
      <span className="inline-flex">
        <DropdownMenu>
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
              setActive(kind);
            }}
          >
            {KINDS.map((kind) => (
              <DropdownMenuItem
                key={kind}
                onSelect={() => {
                  picked.current = kind;
                }}
              >
                {LINK_COPY[kind].add}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </span>
    </TaskSearchPopover>
  );
}

/** Props for {@link RelationGroup}. */
interface RelationGroupProps {
  readonly kind: SectionLink;
  readonly task: TaskDetail;
  readonly otherProject: OtherProjectName;
  readonly canEdit: boolean;
}

/**
 * One kind of link: its label, then a segment per linked task.
 *
 * @param props - See {@link RelationGroupProps}.
 * @returns the labelled group.
 */
function RelationGroup({ kind, task, otherProject, canEdit }: RelationGroupProps): JSX.Element {
  const { writes } = useTaskRelationControls();
  const copy = LINK_COPY[kind];
  return (
    <div role="group" aria-label={copy.group} className="flex flex-col">
      <h3 className="text-on-surface-variant text-label-medium flex h-7 items-center px-3">
        {copy.group}
      </h3>
      <SegmentedList>
        {linkedAs(task, kind).map((ref) => (
          <TaskRelationRow
            key={ref.id}
            orgId={task.organizationId}
            task={ref}
            hint={ref.projectId ? otherProject(ref.projectId) : null}
            onRename={canEdit ? writes.rename : undefined}
            remove={
              canEdit
                ? {
                    label: copy.remove,
                    onRemove: () => {
                      writes.unlink(kind, ref.id);
                    },
                  }
                : undefined
            }
          />
        ))}
      </SegmentedList>
    </div>
  );
}
