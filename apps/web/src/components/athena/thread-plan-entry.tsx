'use client';

/**
 * `thread-plan-entry` — a plan opened on the canvas, as a flat entry in the conversation.
 *
 * @remarks
 * The same anatomy as a work entry: a state dot in a 24px gutter, the plan's title as the title
 * line with `Open canvas` trailing it, and one concrete state line — how many drafts the plan
 * holds, or that it was confirmed. The line reads the plan live, so it stays true after the
 * conversation moves on; until that read lands it falls back to the counts the tool reported when
 * the plan opened.
 */
import type { PlanDraftOut } from '@docket/work/plan-draft-contract';
import { cn } from '@docket/ui/lib/utils';
import { Button } from '@docket/ui/primitives';
import type { JSX } from 'react';

import Link from '@/components/docket-link';
import type { PlanStartSummary } from '@/components/plan-canvas/plan-start-card';
import { countLabel } from '@/lib/athena/job-presentation';
import { planDef } from '@/lib/plan-draft/defs';
import { useApiQuery } from '@/lib/query';

/** Props for {@link ThreadPlanEntry}. */
export interface ThreadPlanEntryProps {
  /** The plan a `plan_start` call opened, read off the call's result. */
  readonly plan: PlanStartSummary;
}

/** Whether a plan is still being shaped, which is what lights its dot. */
function isOpen(plan: PlanDraftOut | undefined): boolean {
  return plan === undefined || plan.status === 'active';
}

/**
 * The plan's state line: "Confirmed", "Archived", or its drafts and confirmed nodes.
 *
 * @param plan - The live plan, or `undefined` before it loads.
 * @param opened - The counts the tool reported when the plan opened.
 */
export function planStateLine(plan: PlanDraftOut | undefined, opened: PlanStartSummary): string {
  if (!plan) return countLabel(opened.counts.draft, 'draft');
  if (plan.status === 'committed') return 'Confirmed';
  if (plan.status === 'archived') return 'Archived';
  const confirmed = plan.document.nodes.filter((node) => node.status === 'confirmed').length;
  const drafts = countLabel(plan.document.nodes.length - confirmed, 'draft');
  return confirmed > 0 ? `${drafts} · ${String(confirmed)} confirmed` : drafts;
}

/** A plan on the canvas as a thread entry: title, state, and the way onto the canvas. */
export function ThreadPlanEntry({ plan }: ThreadPlanEntryProps): JSX.Element {
  const live = useApiQuery(planDef(plan.planId));
  const titleId = `thread-plan-${plan.planId}-title`;
  return (
    <article
      aria-labelledby={titleId}
      data-slot="athena-plan-entry"
      data-plan={plan.planId}
      className="relative flex w-full max-w-160 flex-col gap-2 pl-6"
    >
      <span
        aria-hidden="true"
        className={cn(
          'absolute top-3 left-2 size-2 rounded-full',
          isOpen(live.data) ? 'bg-primary' : 'bg-on-surface-variant/30',
        )}
      />
      <div className="flex min-h-8 items-center gap-2">
        <h3 id={titleId} className="text-on-surface text-title-small min-w-0 flex-1 truncate">
          {live.data?.title ?? plan.title}
        </h3>
        <Button asChild variant="ghost" controlSize="md" className="-mr-3 shrink-0">
          <Link href={plan.href}>Open canvas</Link>
        </Button>
      </div>
      <p data-slot="athena-plan-state" className="text-on-surface-variant text-body-small -mt-1">
        {planStateLine(live.data, plan)}
      </p>
    </article>
  );
}
