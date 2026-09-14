'use client';

/**
 * `components/plan-canvas/plan-start-card` — Athena's offer to plan on the canvas, in the thread.
 *
 * @remarks
 * Athena opens a plan by calling `plan_start`; the tool's result is what this card renders, so the
 * offer is a durable activity rather than a transient banner. Opening it is the yes: the card
 * links to the canvas route and the shell keeps the rail beside it. A reload finds the card where
 * it was, and a plan opened days ago can be reopened from the same place.
 */
import { ArrowRight, Sparkles } from '@docket/ui/icons';
import { cn } from '@docket/ui/lib/utils';
import { Surface, surfaceToneColor } from '@docket/ui/primitives';
import type { JSX } from 'react';

import Link from '@/components/docket-link';

/** What the card needs from a `plan_start` result. */
export interface PlanStartSummary {
  readonly planId: string;
  readonly href: string;
  readonly title: string;
  readonly counts: { readonly projects: number; readonly tasks: number; readonly draft: number };
}

/**
 * Read a `plan_start` result off an action activity's stored tool result.
 *
 * @remarks
 * The result text is the tool's JSON payload; it is untrusted JSON and is read defensively. Only
 * a payload naming a plan id and a canvas route under `/orgs/` becomes a card.
 */
export function parsePlanStart(content: unknown): PlanStartSummary | null {
  if (typeof content !== 'string') return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== 'object') return null;
  const record = parsed as Record<string, unknown>;
  const planId = record['planId'];
  const href = record['href'];
  const title = record['title'];
  if (typeof planId !== 'string' || typeof href !== 'string' || !href.startsWith('/orgs/')) {
    return null;
  }
  const counts = (record['counts'] ?? {}) as Record<string, unknown>;
  const count = (key: string): number => {
    const value = counts[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
  };
  return {
    planId,
    href,
    title: typeof title === 'string' && title.length > 0 ? title : 'New plan',
    counts: { projects: count('projects'), tasks: count('tasks'), draft: count('draft') },
  };
}

/** Props for {@link PlanStartCard}. */
export interface PlanStartCardProps {
  readonly plan: PlanStartSummary;
  readonly className?: string | undefined;
}

/** The card that opens the canvas from the thread. */
export default function PlanStartCard({ plan, className }: PlanStartCardProps): JSX.Element {
  const { projects, tasks } = plan.counts;
  const summary =
    projects === 0 && tasks === 0
      ? 'Shape it with Athena on the canvas.'
      : `${String(projects)} ${projects === 1 ? 'project' : 'projects'} · ${String(tasks)} ${tasks === 1 ? 'task' : 'tasks'} so far`;
  return (
    <Surface
      tone="canvas"
      shape="medium"
      className={cn('mr-auto w-full max-w-[85%]', className)}
      data-testid="plan-start-card"
    >
      <Link
        href={plan.href}
        className="focus-visible:ring-ring flex items-center gap-3 rounded-[inherit] px-4 py-3 focus-visible:ring-2 focus-visible:outline-none"
      >
        <span
          className={cn(
            surfaceToneColor('prominent'),
            'text-primary flex size-9 shrink-0 items-center justify-center rounded-lg',
          )}
        >
          <Sparkles aria-hidden="true" className="size-5" />
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-on-surface-variant text-label-small">Plan on the canvas</span>
          <span className="text-on-surface text-title-small truncate">{plan.title}</span>
          <span className="text-on-surface-variant text-body-small truncate">{summary}</span>
        </span>
        <span className="text-primary text-label-large inline-flex shrink-0 items-center gap-1">
          Open canvas <ArrowRight aria-hidden="true" className="size-4" />
        </span>
      </Link>
    </Surface>
  );
}
