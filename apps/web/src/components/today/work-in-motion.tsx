import type { HubTodayStatusCard } from '@docket/types';
import { ArrowRight, Flag, Layers } from '@docket/ui/icons';
import Link from 'next/link';
import type { JSX } from 'react';

import { OrgChip } from '@/components/org-chip';
import { relativeTime } from '@/components/project-detail/format-time';
import { formatCalendarDate } from '@/lib/format-date';

/** Props for grounded Project and Initiative status stories. */
export interface WorkInMotionProps {
  readonly cards: readonly HubTodayStatusCard[];
  readonly orgName: (organizationId: string) => string;
}

function healthLabel(health: HubTodayStatusCard['health']): string {
  if (!health) return 'No health set';
  return health.replaceAll('_', ' ');
}

function calendarDate(date: string): string {
  return formatCalendarDate(date, { month: 'short', day: 'numeric' }) ?? date;
}

/** Connect today's execution to at most four visible larger outcomes. */
export default function WorkInMotion({ cards, orgName }: WorkInMotionProps): JSX.Element | null {
  if (cards.length === 0) return null;
  return (
    <section aria-labelledby="work-in-motion-heading">
      <div className="mb-3 flex items-end justify-between gap-4">
        <div>
          <h2 id="work-in-motion-heading" className="text-on-surface text-title-large">
            Work in motion
          </h2>
          <p className="text-on-surface-variant text-body-small mt-0.5">
            The outcomes today’s work is moving.
          </p>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 @2xl:grid-cols-2">
        {cards.slice(0, 4).map((card) => {
          const href = `/orgs/${card.organizationId}/${card.kind === 'project' ? 'projects' : 'initiatives'}/${card.id}`;
          const healthTone =
            card.health === 'off_track'
              ? 'text-error bg-error/8'
              : card.health === 'at_risk'
                ? 'text-warning bg-warning/10'
                : 'text-on-surface-variant bg-surface-container-high';
          return (
            <article
              key={`${card.kind}:${card.id}`}
              className="border-outline-variant bg-surface-container-lowest group relative overflow-hidden rounded-xl border p-4"
            >
              <div className="bg-primary/65 absolute inset-y-0 left-0 w-1" aria-hidden />
              <div className="flex items-start justify-between gap-3 pl-1">
                <div className="min-w-0">
                  <p className="text-on-surface-variant text-label-small flex items-center gap-1.5">
                    {card.kind === 'project' ? (
                      <Flag className="size-3.5" />
                    ) : (
                      <Layers className="size-3.5" />
                    )}
                    {card.kind}
                  </p>
                  <Link
                    href={href}
                    className="text-on-surface text-title-small focus-visible:ring-ring mt-1 block hover:underline focus-visible:rounded focus-visible:ring-2 focus-visible:outline-none"
                  >
                    {card.name}
                  </Link>
                </div>
                <OrgChip orgId={card.organizationId} name={orgName(card.organizationId)} />
              </div>
              <div className="mt-3 flex items-center gap-2 pl-1">
                <span
                  className={`text-label-small rounded-full px-2 py-1 capitalize ${healthTone}`}
                >
                  {healthLabel(card.health)}
                </span>
                <span className="text-on-surface-variant text-label-small capitalize">
                  {card.status.replaceAll('_', ' ')}
                </span>
              </div>
              <p className="text-on-surface text-body-medium mt-3 min-h-10 pl-1">
                {card.latestUpdate?.excerpt ?? 'No update yet'}
              </p>
              {card.latestUpdate ? (
                <p className="text-on-surface-variant text-label-small mt-1 pl-1">
                  Updated {relativeTime(card.latestUpdate.createdAt)}
                </p>
              ) : null}
              {card.kind === 'project' ? (
                <div className="mt-3 pl-1">
                  <div className="text-on-surface-variant text-body-small mb-1 flex justify-between">
                    <span>
                      {String(card.progress.completed)} of {String(card.progress.total)} tasks
                      complete
                    </span>
                    {card.nextMilestone ? (
                      <span>
                        {card.nextMilestone.name} · {calendarDate(card.nextMilestone.targetDate)}
                      </span>
                    ) : null}
                  </div>
                  <div className="bg-surface-container-high h-1.5 overflow-hidden rounded-full">
                    <div
                      className="bg-primary h-full rounded-full"
                      style={{
                        width: `${String(card.progress.total > 0 ? Math.round((card.progress.completed / card.progress.total) * 100) : 0)}%`,
                      }}
                    />
                  </div>
                </div>
              ) : (
                <div className="text-on-surface-variant text-body-small mt-3 flex justify-between gap-3 pl-1">
                  <span>
                    {String(card.connectedWork.onTrack)} on track ·{' '}
                    {String(card.connectedWork.atRisk)} at risk
                  </span>
                  {card.targetDate ? <span>Target {calendarDate(card.targetDate)}</span> : null}
                </div>
              )}
              <Link
                href={href}
                aria-label={`Open ${card.name}`}
                className="text-primary text-label-large focus-visible:ring-ring mt-3 flex min-h-11 items-center justify-end gap-1 focus-visible:rounded focus-visible:ring-2 focus-visible:outline-none"
              >
                Open {card.kind} <ArrowRight className="size-4" />
              </Link>
            </article>
          );
        })}
      </div>
    </section>
  );
}
