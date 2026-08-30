/**
 * `today/project-status` — the Projects and Initiatives today's tasks belong to, as rows.
 *
 * @remarks
 * This was a two-column grid of four ~230px cards that consumed the entire fold to carry about five
 * facts each — and on a young workspace three of those five were "No update yet", "0 of 0 tasks
 * complete", and a progress bar sitting at zero. The same four items are four rows.
 *
 * Three specific things the cards got wrong, fixed here rather than restyled:
 *
 * 1. **A zero-of-zero progress bar is a lie.** An empty track reads as "no progress made" when it
 *    actually means "this project has no tasks". A project with nothing in it says so in words.
 * 2. **A health chip on healthy work is noise.** Every card carried one, so the four "At Risk"
 *    chips in a row had nothing to contrast against and the signal died. `on_track` is the
 *    expected state and spends no chip; only `at_risk` and `off_track` do.
 * 3. **"No update yet" is not an update.** The card reserved two lines (`min-h-10`) for a sentence
 *    that was not there, four times over. An absent update renders nothing at all.
 *
 * The trailing "Open project →" link is gone too: the whole row is the link, so the affordance was
 * a second control pointing where the first one already went.
 */
import type { HubTodayStatusCard } from '@docket/types';
import { EntityList, EntityListRow, RowMeta, RowProgress } from '@docket/ui/components';
import { Flag, Layers } from '@docket/ui/icons';
import { Badge } from '@docket/ui/primitives';
import Link from '@/components/docket-link';
import type { JSX } from 'react';

import { OrgChip } from '@/components/org-chip';
import { formatCalendarDate } from '@/lib/format-date';

import { TodaySection } from './today-section';

/** Props for {@link ProjectStatus}. */
export interface ProjectStatusProps {
  readonly cards: readonly HubTodayStatusCard[];
  readonly orgName: (organizationId: string) => string;
}

function calendarDate(date: string): string {
  return formatCalendarDate(date, { month: 'short', day: 'numeric' }) ?? date;
}

/**
 * The health chip, or nothing.
 *
 * @remarks
 * Returns null for `on_track` and for unset health. A chip that appears on every row is a column,
 * and a column of identical values is not a signal.
 */
function HealthChip({
  health,
}: {
  readonly health: HubTodayStatusCard['health'];
}): JSX.Element | null {
  if (health !== 'at_risk' && health !== 'off_track') return null;
  return (
    <Badge variant={health === 'off_track' ? 'destructive' : 'secondary'}>
      {health === 'off_track' ? 'Off track' : 'At risk'}
    </Badge>
  );
}

/** At most four Projects or Initiatives, each with its health, progress, and latest update. */
export default function ProjectStatus({ cards, orgName }: ProjectStatusProps): JSX.Element | null {
  if (cards.length === 0) return null;
  const visible = cards.slice(0, 4);
  return (
    <TodaySection
      id="project-status-heading"
      heading="Projects & initiatives"
      count={visible.length}
    >
      <EntityList aria-label="Projects and initiatives" tone="tonal">
        {visible.map((card) => {
          const href = `/orgs/${card.organizationId}/${card.kind === 'project' ? 'projects' : 'initiatives'}/${card.id}`;
          return (
            <EntityListRow
              key={`${card.kind}:${card.id}`}
              href={href}
              render={(props) => (
                <Link {...props} href={href}>
                  {props.children}
                </Link>
              )}
              leading={
                card.kind === 'project' ? (
                  <Flag aria-hidden="true" className="text-on-surface-variant size-4" />
                ) : (
                  <Layers aria-hidden="true" className="text-on-surface-variant size-4" />
                )
              }
              title={card.name}
              {...(card.latestUpdate ? { subtitle: card.latestUpdate.excerpt, wrap: true } : {})}
              meta={
                <>
                  <HealthChip health={card.health} />
                  {card.kind === 'project' ? (
                    card.progress.total === 0 ? (
                      <RowMeta>No tasks yet</RowMeta>
                    ) : (
                      <RowMeta tabular>
                        <RowProgress
                          value={(card.progress.completed / card.progress.total) * 100}
                          label={`${card.name} task completion`}
                        />
                        {String(card.progress.completed)}/{String(card.progress.total)}
                      </RowMeta>
                    )
                  ) : (
                    <RowMeta tabular>
                      {String(card.connectedWork.onTrack)} on track ·{' '}
                      {String(card.connectedWork.atRisk)} at risk
                    </RowMeta>
                  )}
                  {card.kind === 'project' && card.nextMilestone ? (
                    <RowMeta tabular>
                      {card.nextMilestone.name} · {calendarDate(card.nextMilestone.targetDate)}
                    </RowMeta>
                  ) : null}
                  {card.kind === 'initiative' && card.targetDate ? (
                    <RowMeta tabular>Target {calendarDate(card.targetDate)}</RowMeta>
                  ) : null}
                  <RowMeta>
                    <OrgChip orgId={card.organizationId} name={orgName(card.organizationId)} />
                  </RowMeta>
                </>
              }
            />
          );
        })}
      </EntityList>
    </TodaySection>
  );
}
