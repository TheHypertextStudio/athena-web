'use client';

/**
 * `views/task-identity-cell` — a task row's identity in the shared {@link TaskTable}: its entity
 * icon followed by its title, indented one step per level under a parent Task, with the rails that
 * connect a parent to its subtasks.
 *
 * @remarks
 * This is the Tasks page's identity cell in the task table's terms: the same 32px entity icon, the
 * same gap to the title, and the same rail geometry ({@link HIERARCHY_LEADING_SLOT_PX}), so a task
 * reads the same in a project's list as on the Tasks page. Status is its own column. The icon and
 * title share one cell so a subtask's whole identity moves in together. The title carries its own
 * link, which keeps the icon out of the link's accessible name; the table points its link column
 * at {@link TASK_TABLE_INLINE_LINK_COLUMN_KEY} so it does not wrap the cell a second time.
 *
 * Rails draw in an `absolute inset-y-0` layer. No cell between it and the row is positioned, so the
 * layer spans the full row height (EntityTable rows are `relative`) while its horizontal static
 * position stays at the start of the cell. Segments that must meet the next row are percentage
 * lines, and the elbow is drawn in a nested SVG anchored at the row's vertical center, so the rails
 * stay joined at any row height, including a taller row carrying a proposal sentence.
 */
import type { Column } from '@docket/ui/components';
import { withoutUndefinedValues } from '@docket/ui';
import { defaultEntityDisplay, type EntityDisplayOut } from '@docket/work/entity-display-contract';
import type { TaskOut } from '@docket/work/task-model';
import type { JSX, ReactNode } from 'react';

import Link from '@/components/docket-link';
import { EntityIconGlyph } from '@/components/entity-display/entity-icon-glyph';
import {
  HIERARCHY_DEPTH_PX,
  HIERARCHY_ELBOW_RADIUS_PX,
  HIERARCHY_LEADING_SLOT_PX,
  HIERARCHY_RAIL_STROKE_PX,
  HIERARCHY_SLOT_CENTER_PX,
  type HierarchyPosition,
} from '@/components/work-views/hierarchy-rails';

import type { TaskPositions } from './task-table-hierarchy';

/** Link column key matching no column, so the table leaves the title's own link in charge. */
export const TASK_TABLE_INLINE_LINK_COLUMN_KEY = '__task-table-inline-link';

/** A length past any row edge, so the outer SVG clips an open-ended segment at the boundary. */
const RAIL_OVERRUN_PX = 1000;

/** Width of the entity icon's slot; the header spacer uses it so "Title" lines up. */
const ICON_SLOT_CLASSNAME = 'flex size-8 shrink-0 items-center justify-center';

/** The icon slot plus the gap after it, and enough title to read, before any indentation. */
const IDENTITY_BASE_MIN_WIDTH = '5.75rem';

/** Props for the rail layer of one task row. */
interface TaskHierarchyRailsProps {
  /** The row's hierarchy position. */
  readonly position: HierarchyPosition;
}

/** Props for {@link TaskIdentityHeader}. */
interface TaskIdentityHeaderProps {
  /** The header label. */
  readonly label: ReactNode;
}

/** The rail x for an entity icon at a one-based depth. */
function railX(depth: number): number {
  return (depth - 1) * HIERARCHY_DEPTH_PX + HIERARCHY_SLOT_CENTER_PX;
}

/** The parent's rail turning into this row, relative to the row's vertical center. */
function elbowPath(depth: number, isLastSibling: boolean): string {
  const x = railX(depth - 1);
  const radius = HIERARCHY_ELBOW_RADIUS_PX;
  const start = isLastSibling ? `M ${String(x)} ${String(-RAIL_OVERRUN_PX)} V` : `M ${String(x)}`;
  const glyphLeft = (depth - 1) * HIERARCHY_DEPTH_PX;
  return `${start} ${String(-radius)} Q ${String(x)} 0 ${String(x + radius)} 0 H ${String(glyphLeft)}`;
}

/** Full-height rails: ancestors whose branch continues, and the parent's when siblings follow. */
function ThroughRails({ position }: TaskHierarchyRailsProps): JSX.Element {
  const { depth, ancestorRailContinues, isLastSibling } = position;
  const through = ancestorRailContinues.flatMap((continues, index) =>
    continues ? [index + 1] : [],
  );
  if (depth > 1 && !isLastSibling) through.push(depth - 1);
  return (
    <>
      {through.map((ancestorDepth) => (
        <line
          key={ancestorDepth}
          x1={railX(ancestorDepth)}
          y1="0"
          x2={railX(ancestorDepth)}
          y2="100%"
        />
      ))}
    </>
  );
}

/**
 * Draw the rails for one task row.
 *
 * @param props - The row's hierarchy position.
 * @returns the decorative rail layer, or `null` for a top-level row with no subtasks.
 */
export function TaskHierarchyRails({ position }: TaskHierarchyRailsProps): JSX.Element | null {
  const { depth, hasChildren, isLastSibling } = position;
  if (depth === 1 && !hasChildren) return null;
  return (
    <span
      aria-hidden="true"
      data-testid="hierarchy-rail"
      className="pointer-events-none absolute inset-y-0"
      style={{ width: (depth - 1) * HIERARCHY_DEPTH_PX + HIERARCHY_LEADING_SLOT_PX }}
    >
      <svg focusable="false" className="h-full w-full overflow-hidden">
        <g
          className="stroke-outline-variant"
          fill="none"
          strokeWidth={HIERARCHY_RAIL_STROKE_PX}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <ThroughRails position={position} />
          <svg y="50%" overflow="visible">
            {depth > 1 ? <path d={elbowPath(depth, isLastSibling)} /> : null}
            {hasChildren ? (
              <path
                d={`M ${String(railX(depth))} ${String(HIERARCHY_SLOT_CENTER_PX)} V ${String(RAIL_OVERRUN_PX)}`}
              />
            ) : null}
          </svg>
        </g>
      </svg>
    </span>
  );
}

/**
 * The Title header, offset past the icon slot so it lines up with top-level titles.
 *
 * @param props - The header label.
 * @returns the header content.
 */
export function TaskIdentityHeader({ label }: TaskIdentityHeaderProps): JSX.Element {
  return (
    <span className="flex min-w-0 items-center gap-3">
      <span aria-hidden="true" className={ICON_SLOT_CLASSNAME} />
      <span className="truncate">{label}</span>
    </span>
  );
}

/** Props for {@link TaskIdentity}. */
export interface TaskIdentityProps {
  /** The row's task. */
  readonly task: TaskOut;
  /** The task's customized identity, when it has one. */
  readonly display: EntityDisplayOut | undefined;
  /** The row's place under its parent Task, when the list nests. */
  readonly position: HierarchyPosition | undefined;
  /** The task detail href. */
  readonly href: string;
  /** Runs when the title link is followed. */
  readonly onOpen?: (() => void) | undefined;
  /** Warms the task detail on hover or focus. */
  readonly onPrefetch?: (() => void) | undefined;
  /** The title content. */
  readonly children: ReactNode;
}

/**
 * Render one task row's identity cell.
 *
 * @param props - See {@link TaskIdentityProps}.
 * @returns the entity icon and title link, indented by depth, with rails.
 */
export function TaskIdentity({
  task,
  display,
  position,
  href,
  onOpen,
  onPrefetch,
  children,
}: TaskIdentityProps): JSX.Element {
  const shown = display ?? defaultEntityDisplay('task', task.id);
  const indent = position === undefined ? 0 : (position.depth - 1) * HIERARCHY_DEPTH_PX;
  return (
    <span className="flex min-w-0 items-center gap-3">
      {position ? <TaskHierarchyRails position={position} /> : null}
      <span className={ICON_SLOT_CLASSNAME} style={{ marginLeft: indent }}>
        <EntityIconGlyph
          subjectType="task"
          glyph={shown.glyph}
          colorKey={shown.colorKey}
          customColor={shown.customColor}
          size={HIERARCHY_LEADING_SLOT_PX}
        />
      </span>
      <Link
        href={href}
        className="min-w-0 truncate rounded-md outline-none focus-visible:ring-2"
        {...withoutUndefinedValues({
          onClick: onOpen,
          onMouseEnter: onPrefetch,
          onFocus: onPrefetch,
        })}
      >
        {children}
      </Link>
    </span>
  );
}

/** What {@link withTaskIdentity} needs to render each row's identity cell. */
export interface TaskIdentityDeps {
  /** Customized task identities, keyed by task id. */
  readonly displayByTaskId: ReadonlyMap<string, EntityDisplayOut> | undefined;
  /** Pending proposal sentences, keyed by task id. */
  readonly proposedByTaskId: ReadonlyMap<string, string> | undefined;
  /** Hierarchy positions, keyed by row object. */
  readonly positions: TaskPositions;
  /** Build the task detail href. */
  readonly taskHref: (task: TaskOut) => string;
  /** Runs when a title link is followed. */
  readonly onOpenTask?: ((task: TaskOut) => void) | undefined;
  /** Warms a task detail on hover or focus. */
  readonly onRowPrefetch?: ((task: TaskOut) => void) | undefined;
}

/** The title content, with a pending proposal's sentence beneath it. */
function titleWithProposal(
  title: Column<TaskOut>,
  task: TaskOut,
  sentence: string | undefined,
): ReactNode {
  if (sentence === undefined) return title.render(task);
  return (
    <span className="flex min-w-0 flex-col gap-0.5">
      {title.render(task)}
      <span className="text-body-small text-on-surface-variant truncate">{sentence}</span>
    </span>
  );
}

/**
 * The identity column's minimum width: the icon slot, the deepest row's indentation, and some
 * title, so a deep subtask's icon never spills into the next column on a narrow table.
 */
function identityMinWidth(positions: TaskPositions): string {
  let deepest = 1;
  for (const position of positions.values()) deepest = Math.max(deepest, position.depth);
  return `calc(${IDENTITY_BASE_MIN_WIDTH} + ${String((deepest - 1) * HIERARCHY_DEPTH_PX)}px)`;
}

/**
 * Turn the `title` column into the identity cell: entity icon, indentation, rails, and title link.
 *
 * @param columns - Columns from `buildTaskColumns`.
 * @param deps - See {@link TaskIdentityDeps}.
 * @returns the columns with the identity cell in the title's place.
 */
export function withTaskIdentity(
  columns: readonly Column<TaskOut>[],
  deps: TaskIdentityDeps,
): readonly Column<TaskOut>[] {
  return columns.map((title) => {
    if (title.key !== 'title') return title;
    return {
      ...title,
      header: <TaskIdentityHeader label={title.header} />,
      minWidth: identityMinWidth(deps.positions),
      render: (task: TaskOut) => (
        <TaskIdentity
          task={task}
          display={deps.displayByTaskId?.get(task.id)}
          position={deps.positions.get(task)}
          href={deps.taskHref(task)}
          onOpen={deps.onOpenTask ? () => deps.onOpenTask?.(task) : undefined}
          onPrefetch={deps.onRowPrefetch ? () => deps.onRowPrefetch?.(task) : undefined}
        >
          {titleWithProposal(title, task, deps.proposedByTaskId?.get(task.id))}
        </TaskIdentity>
      ),
    };
  });
}
