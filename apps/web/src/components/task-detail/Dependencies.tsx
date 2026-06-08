'use client';

import type { TaskRef } from '@docket/types';
import { StatusIcon } from '@docket/ui/components';
import { ChevronLeft, ChevronRight } from '@docket/ui/icons';
import type { JSX } from 'react';

import { stateTypeOf } from '@/lib/work-state';

/** Props for {@link Dependencies}. */
interface DependenciesProps {
  /** Tasks this task blocks (it is the blocking side of each edge). */
  blocking: readonly TaskRef[];
  /** Tasks blocking this task (it is the blocked side of each edge). */
  blockedBy: readonly TaskRef[];
  /** Resolve a project id to its display name (deps are cross-project). */
  projectName: (projectId: string) => string;
  /** Vocabulary-resolved singular noun for a project (e.g. "Engagement"). */
  projectLabel: string;
  /** Navigate to a dependency task's own detail view. */
  onOpen: (taskId: string) => void;
}

/** One dependency edge rendered as a status glyph, title, and the task's project. */
function DependencyRow({
  task,
  projectName,
  projectLabel,
  onOpen,
}: {
  task: TaskRef;
  projectName: (projectId: string) => string;
  projectLabel: string;
  onOpen: (taskId: string) => void;
}): JSX.Element {
  return (
    <li>
      <button
        type="button"
        onClick={() => {
          onOpen(task.id);
        }}
        className="hover:bg-surface-container-high focus-visible:ring-ring -mx-2 flex w-[calc(100%+1rem)] items-center gap-2 rounded-md px-2 py-1.5 text-left focus-visible:ring-1 focus-visible:outline-none"
      >
        <StatusIcon type={stateTypeOf(task.state)} />
        <span className="min-w-0 flex-1 truncate text-sm">{task.title}</span>
        <span className="text-on-surface-variant shrink-0 text-xs">
          {task.projectId ? projectName(task.projectId) : `No ${projectLabel.toLowerCase()}`}
        </span>
      </button>
    </li>
  );
}

/**
 * The task's cross-project dependency graph: what it is blocked by and what it blocks.
 *
 * @remarks
 * Two stacked groups, each headed by a directional icon: "Blocked by" (this task waits on
 * those) and "Blocking" (those wait on this task). Because Docket's `blocks` graph spans
 * projects, every row surfaces the other task's project so the cross-project link is
 * legible. Rows link to the referenced task's own detail. When both lists are empty the
 * section renders a single muted empty state rather than two.
 */
export function Dependencies({
  blocking,
  blockedBy,
  projectName,
  projectLabel,
  onOpen,
}: DependenciesProps): JSX.Element {
  const empty = blocking.length === 0 && blockedBy.length === 0;

  return (
    <section aria-labelledby="dependencies-heading" className="flex flex-col gap-3">
      <h2 id="dependencies-heading" className="text-sm font-medium">
        Dependencies
      </h2>

      {empty ? (
        <p className="text-on-surface-variant text-sm">No dependencies.</p>
      ) : (
        <div className="flex flex-col gap-4">
          {blockedBy.length > 0 ? (
            <div className="flex flex-col gap-1">
              <div className="text-on-surface-variant flex items-center gap-1.5 text-xs font-medium tracking-wide uppercase">
                <ChevronLeft className="size-3.5" />
                Blocked by
              </div>
              <ul className="flex flex-col">
                {blockedBy.map((task) => (
                  <DependencyRow
                    key={task.id}
                    task={task}
                    projectName={projectName}
                    projectLabel={projectLabel}
                    onOpen={onOpen}
                  />
                ))}
              </ul>
            </div>
          ) : null}

          {blocking.length > 0 ? (
            <div className="flex flex-col gap-1">
              <div className="text-on-surface-variant flex items-center gap-1.5 text-xs font-medium tracking-wide uppercase">
                <ChevronRight className="size-3.5" />
                Blocking
              </div>
              <ul className="flex flex-col">
                {blocking.map((task) => (
                  <DependencyRow
                    key={task.id}
                    task={task}
                    projectName={projectName}
                    projectLabel={projectLabel}
                    onOpen={onOpen}
                  />
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}
