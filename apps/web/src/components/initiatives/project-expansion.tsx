'use client';

/**
 * What one Project says when its row is opened.
 *
 * @remarks
 * Read on demand, from the Project's own detail aggregate, and cached under the same key that
 * page uses — so opening a row here costs one request the first time and none after, and the
 * Project's page is already warm if the reader goes there next.
 *
 * Only facts the collapsed row could not carry. The name, the summary and the status glyph are
 * already on the row above; repeating them would spend the height this panel just claimed on
 * things the reader can still see.
 */
import { Skeleton } from '@docket/ui/primitives';
import type { JSX } from 'react';

import type { Health } from '@docket/work/capability-contract';
import type { LucideIcon } from '@docket/ui/icons';
import { CalendarToday, TaskAlt, User } from '@docket/ui/icons';

import { HealthLabel } from '@/components/entity-display/health';
import { useWorkStatusResolver } from '@/components/entity-display/use-work-status';
import { WorkStatusBadge, type WorkStatusDisplay } from '@/components/entity-display/work-status';
import { ExcerptMarkdown } from '@/components/mentions/excerpt-markdown';
import { projectDetailAggregateDef } from '@/lib/detail-aggregate';
import { formatPlanningTimeframe, toPlanningTimeframe } from '@/lib/planning-timeframe';
import { useApiQuery } from '@/lib/query';

/** Props for {@link ProjectExpansion}. */
export interface ProjectExpansionProps {
  /** The workspace that owns the Project. */
  readonly organizationId: string;
  readonly projectId: string;
  /** Whether the row is open; false leaves the read unissued. */
  readonly enabled: boolean;
}

/** Props for the private {@link Fact}. */
interface FactProps {
  readonly icon: LucideIcon;
  readonly label: string;
  readonly children: React.ReactNode;
}

/**
 * One fact, drawn the way the rest of the app draws that kind of fact.
 *
 * @remarks
 * A glyph carries what the fact is about, so the value never has to be a bare word floating in a
 * sentence. The label is the accessible name rather than visible text: four printed labels over
 * four one-word values is a table nobody asked for, and a glyph a screen reader cannot name is
 * worse than no glyph at all.
 */
function Fact({ icon: Icon, label, children }: FactProps): JSX.Element {
  return (
    <span className="text-on-surface-variant text-body-small flex min-w-0 items-center gap-1.5">
      <Icon aria-hidden className="size-4 shrink-0" />
      <span className="sr-only">{`${label}: `}</span>
      <span className="min-w-0 truncate">{children}</span>
    </span>
  );
}

/** Props for the private {@link ProjectFacts}. */
interface ProjectFactsProps {
  readonly status: WorkStatusDisplay;
  readonly health: Health | null;
  readonly leadName: string | null;
  readonly target: string | null;
  readonly taskCount: number;
  readonly completedCount: number;
}

/**
 * The facts worth stating about an opened Project.
 *
 * @remarks
 * Only what has been set. A row of "—" spends a reader's attention proving that nobody has named a
 * lead or a target yet, which they can already tell from the Project running without one. Health
 * follows the list's own rule and speaks only when it is not on track: a line of green says
 * nothing, and the one amber entry is the whole point of looking.
 */
function ProjectFacts({
  status,
  health,
  leadName,
  target,
  taskCount,
  completedCount,
}: ProjectFactsProps): JSX.Element {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1.5">
      <WorkStatusBadge name={status.name} category={status.category} />
      {health !== null && health !== 'on_track' ? <HealthLabel health={health} /> : null}
      {leadName !== null ? (
        <Fact icon={User} label="Lead">
          {leadName}
        </Fact>
      ) : null}
      {target !== null ? (
        <Fact icon={CalendarToday} label="Target">
          {target}
        </Fact>
      ) : null}
      {taskCount > 0 ? (
        <Fact icon={TaskAlt} label="Tasks done">
          {`${String(completedCount)} of ${String(taskCount)}`}
        </Fact>
      ) : null}
    </div>
  );
}

/** The opened Project's detail. */
export function ProjectExpansion({
  organizationId,
  projectId,
  enabled,
}: ProjectExpansionProps): JSX.Element {
  const statusOf = useWorkStatusResolver('project');
  const detailQuery = useApiQuery({
    ...projectDetailAggregateDef(organizationId, projectId),
    enabled,
  });

  if (detailQuery.isPending) {
    return (
      <div className="flex flex-col gap-2 pt-1 pb-2">
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-4 w-1/3" />
      </div>
    );
  }

  if (detailQuery.isError) {
    return (
      <p className="text-on-surface-variant text-body-small pt-1 pb-2">
        Could not load this project&rsquo;s detail.
      </p>
    );
  }

  const { defaultView, references } = detailQuery.data;
  const project = defaultView.project;
  const description = (project.description ?? '').trim();
  const timeframe = formatPlanningTimeframe(
    toPlanningTimeframe(
      project.targetDate ?? null,
      project.targetDateResolution ?? null,
      project.targetDateFiscalYearStartMonth ?? null,
    ),
  );
  const progress = defaultView.progress;

  return (
    <div className="flex min-w-0 flex-col gap-2 pt-1 pb-1">
      {description.length > 0 ? (
        <ExcerptMarkdown value={description} className="text-on-surface-variant text-body-small" />
      ) : null}
      <ProjectFacts
        status={statusOf(project.status)}
        health={project.health ?? null}
        leadName={references.lead?.displayName ?? null}
        target={timeframe}
        taskCount={progress.taskCount}
        completedCount={progress.completedCount}
      />
    </div>
  );
}
