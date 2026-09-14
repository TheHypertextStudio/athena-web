'use client';

/**
 * `components/plan-canvas/plan-project-header` — the header band of a project container.
 *
 * @remarks
 * Split from the container so the band's reading order is one place: glyph, name, state chip,
 * open affordance; then who leads it, when it lands, how many rows it holds, and the other
 * initiatives it also belongs to. The band takes a tonal step under the pointer so the container
 * reads as one thing you can grab, where its rows read as things you can move.
 */
import { ActorAvatar } from '@docket/ui/components';
import { ArrowRight, Layers } from '@docket/ui/icons';
import { cn } from '@docket/ui/lib/utils';
import { Badge, surfaceToneColor } from '@docket/ui/primitives';
import type { JSX } from 'react';

import Link from '@/components/docket-link';
import { formatCalendarDate } from '@/lib/format-date';

import { PLAN_PROJECT_HEADER, type PlanProjectNodeData } from './plan-nodes';
import { PlanTasksToggle } from './plan-project-tasks';
import { PlanField, PlanStateChip, PlanStatusGlyph } from './plan-status';

/** Props for {@link PlanAlsoIn}. */
export interface PlanAlsoInProps {
  /** Names of the other initiatives the project also belongs to. */
  readonly names: readonly string[];
}

/**
 * The other initiatives a project also belongs to: one is named, more than one is a count. The
 * full list rides on the chip's `title`, so a pointer resting on it reads every name.
 */
export function PlanAlsoIn({ names }: PlanAlsoInProps): JSX.Element | null {
  if (names.length === 0) return null;
  const single = names.length === 1 ? names[0] : null;
  return (
    <Badge
      variant="secondary"
      title={`Also in ${names.join(', ')}`}
      aria-label={`Also in ${names.join(', ')}`}
      data-testid="plan-also-in"
      className="min-w-0 shrink gap-1"
    >
      <Layers aria-hidden="true" className="size-3 shrink-0" />
      {single === null ? (
        <span>+{names.length}</span>
      ) : (
        <span className="min-w-0 truncate">{single}</span>
      )}
    </Badge>
  );
}

/** Props for {@link PlanProjectHeader}. */
export interface PlanProjectHeaderProps {
  readonly node: PlanProjectNodeData;
  /** Field names the latest revision changed. */
  readonly changed: ReadonlySet<string>;
  /** Show or hide the rows; omitted, the header carries no toggle. */
  readonly onToggleTasks?: (() => void) | undefined;
}

/** The header band: identity row, then the meta row. */
export function PlanProjectHeader({
  node,
  changed,
  onToggleTasks,
}: PlanProjectHeaderProps): JSX.Element {
  const target = formatCalendarDate(node.targetDate, { month: 'short', year: 'numeric' });
  const count = `${String(node.taskCount)} ${node.taskCount === 1 ? 'task' : 'tasks'}`;
  return (
    <div
      style={{ height: PLAN_PROJECT_HEADER }}
      className="group-hover:bg-surface-container-high flex flex-col justify-center gap-1 rounded-t-2xl px-3 transition-colors"
    >
      <div className="flex min-w-0 items-center gap-2">
        <PlanStatusGlyph status={node.status} />
        <PlanField
          changed={changed.has('title')}
          className="text-on-surface text-label-large min-w-0 flex-1 truncate"
        >
          {node.title}
        </PlanField>
        <PlanStateChip status={node.status} />
        {onToggleTasks !== undefined && node.tasks.length > 0 ? (
          <PlanTasksToggle
            expanded={node.expanded}
            count={node.tasks.length}
            onToggle={onToggleTasks}
          />
        ) : null}
        {node.href !== null ? (
          <Link
            href={node.href}
            aria-label={`Open ${node.title}`}
            onClick={(event) => {
              event.stopPropagation();
            }}
            className={cn(
              surfaceToneColor('prominent'),
              'nodrag nopan hover:bg-secondary-container hover:text-on-secondary-container focus-visible:ring-ring inline-flex size-6 shrink-0 items-center justify-center rounded-md opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:outline-none',
            )}
          >
            <ArrowRight className="size-4" />
          </Link>
        ) : null}
      </div>
      <div className="text-on-surface-variant text-label-medium flex min-w-0 items-center gap-x-1.5">
        {node.lead !== null ? (
          <PlanField
            changed={changed.has('leadId')}
            className="flex min-w-0 items-center gap-1 truncate"
          >
            <ActorAvatar
              kind={node.lead.kind}
              name={node.lead.name}
              avatarUrl={node.lead.avatarUrl}
              size={18}
            />
            <span className="min-w-0 truncate">{node.lead.name}</span>
          </PlanField>
        ) : null}
        {target !== null ? (
          <PlanField changed={changed.has('targetDate')} className="shrink-0">
            {node.lead !== null ? '· ' : ''}
            {target}
          </PlanField>
        ) : null}
        <span className="shrink-0">
          {node.lead !== null || target !== null ? '· ' : ''}
          {count}
        </span>
        <PlanAlsoIn names={node.alsoIn} />
      </div>
    </div>
  );
}
