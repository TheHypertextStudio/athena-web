'use client';

/**
 * `today/needs-attention` — work that needs a decision today and is not on the plan.
 *
 * @remarks
 * Three groups, each answering a different question, none of them repeating the plan below:
 *
 * - **Approvals** — an agent paused and is holding for a signature. The DTO calls this "the most
 *   urgent pane" (`apps/api/src/contracts/hub.ts`), and the product doctrine backs it: an agent never
 *   quietly changes things on someone's behalf. A signature outranks anything self-scheduled, so
 *   it sits first.
 * - **Blocked** — a dependency is incomplete, so the task cannot move no matter what else happens.
 * - **Due today** — a deadline lands today on a task that was never accepted into the plan. This is
 *   the one thing on the page a person could otherwise miss entirely.
 *
 * **This section replaced a count.** `GET /v1/hub/today` returns all three arrays, and the page
 * used to render a sentence summing their lengths with the unread mailbox —
 * `approvals + blocked + dueToday + inbox` — so a hundred unread notifications read as a hundred
 * things due today. Splitting the number into named parts was the first fix; showing the rows
 * instead of any number at all is the real one, because a count above a list the reader can
 * already see restates it.
 *
 * Anything already on the plan is filtered out by the caller. A task appearing twice on one screen
 * makes the day look busier than it is, and the plan row carries its own Blocked marker.
 *
 * A group with nothing in it renders nothing, and the section itself disappears when all three are
 * empty. A clear day should be short, not a wall of zeroes.
 */
import type { HubTaskItem } from '../../lib/contracts/hub';
import { EntityList } from '@docket/ui/components';
import { Stack } from '@docket/ui/primitives';
import type { JSX } from 'react';

import HubTaskRow from './hub-task-row';
import { TodaySection } from './today-section';

/** Props for {@link NeedsAttention}. */
export interface NeedsAttentionProps {
  /** Tasks behind agent sessions awaiting this person's approval. */
  readonly approvals: readonly HubTaskItem[];
  /** Tasks blocked by an incomplete dependency. */
  readonly blocked: readonly HubTaskItem[];
  /** Tasks due today that were never accepted into the plan. */
  readonly dueToday: readonly HubTaskItem[];
  /** Resolve a workspace's display name for the row chip. */
  readonly orgName: (orgId: string) => string;
}

/** One titled group of rows, or nothing at all. */
function Group({
  heading,
  tasks,
  orgName,
  showCount,
}: {
  readonly heading: string;
  readonly tasks: readonly HubTaskItem[];
  readonly orgName: (orgId: string) => string;
  /** Whether this group needs its own count — only true when a sibling group also renders. */
  readonly showCount: boolean;
}): JSX.Element | null {
  if (tasks.length === 0) return null;
  return (
    <Stack gap={1}>
      <h3 className="text-on-surface-variant text-label-large">
        {heading}
        {showCount ? <span className="ml-1.5 tabular-nums">{tasks.length}</span> : null}
      </h3>
      <EntityList aria-label={heading} tone="tonal">
        {tasks.map((task) => (
          <HubTaskRow key={task.id} task={task} orgLabel={orgName(task.organizationId)} />
        ))}
      </EntityList>
    </Stack>
  );
}

/** Approvals, blockers, and unplanned deadlines — none of which the plan below covers. */
export default function NeedsAttention({
  approvals,
  blocked,
  dueToday,
  orgName,
}: NeedsAttentionProps): JSX.Element | null {
  const total = approvals.length + blocked.length + dueToday.length;
  if (total === 0) return null;
  // With a single group showing, its count and the section's are the same number printed twice.
  const groups = [approvals, blocked, dueToday].filter((group) => group.length > 0).length;
  const showCount = groups > 1;
  return (
    <TodaySection id="needs-attention-heading" heading="Needs attention" count={total}>
      <Stack gap={4}>
        <Group heading="Approvals" tasks={approvals} orgName={orgName} showCount={showCount} />
        <Group heading="Blocked" tasks={blocked} orgName={orgName} showCount={showCount} />
        <Group heading="Due today" tasks={dueToday} orgName={orgName} showCount={showCount} />
      </Stack>
    </TodaySection>
  );
}
