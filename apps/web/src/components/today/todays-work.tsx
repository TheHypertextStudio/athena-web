'use client';

/**
 * `today/todays-work` — the day's tasks, grouped by workspace.
 *
 * @remarks
 * Replaces `next-up`, which showed at most three rows chosen by a rule that hid things: it took
 * timeboxed calendar blocks first and only fell back to due-today tasks *if there were none*, so a
 * single timeboxed block made every task due today invisible. It also rendered three of the eight
 * fields on a `HubTaskItem`.
 *
 * This renders the `plan` array the page already fetched and previously reduced to a title lookup
 * map. Grouping is by workspace because that is the product's stated reason for the surface to
 * exist — "a person juggling several organizations doesn't need more dashboards, they need one
 * honest plan", with every line carrying the venture it belongs to.
 *
 * The timeboxed *shape* of the day is not here. The shell's agenda rail renders the same day on
 * every route, and two grids of one day on one screen is the duplication that rail was extracted to
 * end.
 */
import type { HubTaskItem } from '@docket/types';
import { Button, Skeleton, Stack } from '@docket/ui/primitives';
import Link from 'next/link';
import type { JSX } from 'react';
import { useMemo } from 'react';

import HubTaskRow from './hub-task-row';

/** Props for {@link TodaysWork}. */
export interface TodaysWorkProps {
  /** Every task on the day's plan, across workspaces. */
  readonly plan: readonly HubTaskItem[];
  /** Resolve a workspace's display name. */
  readonly orgName: (orgId: string) => string;
  /** Whether the first Hub read is still in flight. */
  readonly loading: boolean;
}

/** One workspace's slice of the day. */
interface PlanGroup {
  readonly orgId: string;
  readonly orgLabel: string;
  readonly tasks: HubTaskItem[];
}

/** The day's tasks, grouped by workspace, in the order the workspaces first appear. */
export default function TodaysWork({ plan, orgName, loading }: TodaysWorkProps): JSX.Element {
  const groups = useMemo<PlanGroup[]>(() => {
    const byOrg = new Map<string, PlanGroup>();
    for (const task of plan) {
      const group = byOrg.get(task.organizationId);
      if (group) group.tasks.push(task);
      else
        byOrg.set(task.organizationId, {
          orgId: task.organizationId,
          orgLabel: orgName(task.organizationId),
          tasks: [task],
        });
    }
    return [...byOrg.values()];
  }, [plan, orgName]);

  return (
    <Stack as="section" gap={4} aria-labelledby="today-work-heading">
      {/* The heading paints immediately, loading or not: it is a compile-time constant, and a grey
          bar standing where a known word belongs is strictly less information than the word. */}
      <h2 id="today-work-heading" className="text-on-surface text-title-medium font-semibold">
        Today
      </h2>

      {loading ? (
        <Stack gap={1} aria-hidden="true">
          {[0, 1, 2].map((row) => (
            <Skeleton key={row} className="h-9 w-full rounded-lg" />
          ))}
        </Stack>
      ) : groups.length === 0 ? (
        <Stack gap={2}>
          <p className="text-on-surface-variant text-body-medium">Nothing planned yet.</p>
          <Button asChild variant="outline" size="sm" className="self-start">
            <Link href="/tasks">Pull in work</Link>
          </Button>
        </Stack>
      ) : (
        <Stack gap={4}>
          {groups.map((group) => (
            <Stack key={group.orgId} gap={1}>
              {/* Only worth a workspace heading when the day actually spans more than one. */}
              {groups.length > 1 ? (
                <h3 className="text-on-surface-variant text-label-large">{group.orgLabel}</h3>
              ) : null}
              <Stack as="ul" gap={0}>
                {group.tasks.map((task) => (
                  <li key={task.id}>
                    <HubTaskRow task={task} orgLabel={group.orgLabel} />
                  </li>
                ))}
              </Stack>
            </Stack>
          ))}
        </Stack>
      )}
    </Stack>
  );
}
