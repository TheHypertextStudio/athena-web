'use client';

import type { HubTaskItem } from '@docket/types';
import type { LucideIcon } from '@docket/ui/icons';
import { ChevronDown, ChevronRight } from '@docket/ui/icons';
import { type JSX, useId, useState } from 'react';

import { PlanRow } from './plan-row';

/** Props for {@link AttentionCard}. */
export interface AttentionCardProps {
  /** The card's leading glyph (an `@docket/ui/icons` MUI icon). */
  icon: LucideIcon;
  /** The card's heading (e.g. "Approvals"). */
  title: string;
  /** One-line supporting copy shown when there is something to attend to. */
  activeDescription: string;
  /** One-line "all clear" copy shown when the digest is empty. */
  clearDescription: string;
  /** The org-chipped tasks behind this digest (revealed when expanded). */
  tasks: readonly HubTaskItem[];
  /** Resolve an org's display name by id, for each revealed row's chip. */
  orgName: (orgId: string) => string;
  /**
   * Whether a non-empty digest is an alert (renders the `destructive` tint + `role=status`).
   * Defaults to `false` (an informational digest).
   */
  alert?: boolean;
}

/**
 * An expandable "needs attention" digest card.
 *
 * @remarks
 * Renders a single attention metric — a glyph, a heading, a prominent count, and a one-line
 * description — as a disclosure. When the digest is empty it reads calm and muted (the "all
 * clear" state) and is not interactive; when non-empty it brightens and toggles an inline
 * list of the underlying org-chipped {@link PlanRow}s, each linking to its real task home, so
 * the card both summarizes and navigates onward without a dead-end route. An `alert` digest
 * additionally adopts the `destructive` tint and announces via `role="status"`.
 */
export function AttentionCard({
  icon: Icon,
  title,
  activeDescription,
  clearDescription,
  tasks,
  orgName,
  alert = false,
}: AttentionCardProps): JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const panelId = useId();
  const count = tasks.length;
  const active = count > 0;
  const emphasize = active && alert;

  const iconWrap = emphasize
    ? 'bg-destructive/10 text-destructive'
    : active
      ? 'bg-primary/10 text-primary'
      : 'bg-surface-container text-on-surface-variant';
  const countTone = emphasize
    ? 'text-destructive'
    : active
      ? 'text-on-surface'
      : 'text-on-surface-variant';

  return (
    <div
      {...(emphasize ? { role: 'status' } : {})}
      className="border-outline-variant bg-surface-container-low overflow-hidden rounded-xl border"
    >
      <button
        type="button"
        disabled={!active}
        aria-expanded={active ? expanded : undefined}
        aria-controls={active ? panelId : undefined}
        onClick={() => {
          setExpanded((v) => !v);
        }}
        className="hover:bg-surface-container-high focus-visible:ring-ring focus-visible:ring-offset-background flex w-full items-center gap-3 p-4 text-left transition-colors focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset disabled:cursor-default disabled:hover:bg-transparent"
      >
        <span
          aria-hidden="true"
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${iconWrap}`}
        >
          <Icon className="h-5 w-5" />
        </span>

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-baseline gap-2">
            <span className="text-on-surface text-sm font-semibold">{title}</span>
            <span className={`text-sm font-semibold tabular-nums ${countTone}`}>{count}</span>
          </div>
          <span className="text-on-surface-variant text-xs text-balance">
            {active ? activeDescription : clearDescription}
          </span>
        </div>

        {active ? (
          expanded ? (
            <ChevronDown aria-hidden="true" className="text-on-surface-variant h-4 w-4 shrink-0" />
          ) : (
            <ChevronRight aria-hidden="true" className="text-on-surface-variant h-4 w-4 shrink-0" />
          )
        ) : null}
      </button>

      {active && expanded ? (
        <ul id={panelId} className="border-outline-variant flex flex-col gap-1.5 border-t p-2">
          {tasks.map((task) => (
            <li key={task.id}>
              <PlanRow task={task} orgName={orgName(task.organizationId)} />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
