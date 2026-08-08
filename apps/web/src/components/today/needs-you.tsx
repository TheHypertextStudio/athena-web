'use client';

/**
 * `today/needs-you` — what is waiting on the person, above what they planned to do.
 *
 * @remarks
 * `GET /v1/hub/today` computes `needsAttention.approvals` and `.blocked` on every load — approvals
 * by joining tasks behind every `awaiting_approval` agent session across the caller's workspaces,
 * and blocked by walking the dependency graph — and the page rendered neither. The blocked query in
 * particular ran a task scan plus a dependency join purely to be discarded.
 *
 * The DTO calls approvals "the most urgent pane" (`packages/types/src/hub.ts:104-108`), and the
 * product doctrine backs it: an agent "never quietly changes things on your behalf … it pauses and
 * asks for your go-ahead". If something is holding for your sign-off, that outranks anything you
 * planned, so it sits first.
 *
 * Blocked follows, because a blocked task is the other thing that will not move without you.
 * Neither section renders when empty — an all-clear day should be quiet, not a wall of zeroes.
 */
import type { HubTaskItem } from '@docket/types';
import { Stack } from '@docket/ui/primitives';
import type { JSX } from 'react';

import HubTaskRow from './hub-task-row';

/** Props for {@link NeedsYou}. */
export interface NeedsYouProps {
  /** Tasks behind agent sessions awaiting this person's approval. */
  readonly approvals: readonly HubTaskItem[];
  /** Tasks blocked by an incomplete dependency. */
  readonly blocked: readonly HubTaskItem[];
  /** Resolve a workspace's display name for the row chip. */
  readonly orgName: (orgId: string) => string;
}

/** One titled group of rows, or nothing at all. */
function Group({
  heading,
  tasks,
  orgName,
}: {
  readonly heading: string;
  readonly tasks: readonly HubTaskItem[];
  readonly orgName: (orgId: string) => string;
}): JSX.Element | null {
  if (tasks.length === 0) return null;
  return (
    <Stack gap={1}>
      <h3 className="text-on-surface-variant text-label-large">
        {heading}
        <span className="ml-1.5 tabular-nums">{tasks.length}</span>
      </h3>
      <Stack as="ul" gap={0}>
        {tasks.map((task) => (
          <li key={task.id}>
            <HubTaskRow task={task} orgLabel={orgName(task.organizationId)} />
          </li>
        ))}
      </Stack>
    </Stack>
  );
}

/** Approvals and blockers — the things that will not move until this person acts. */
export default function NeedsYou({
  approvals,
  blocked,
  orgName,
}: NeedsYouProps): JSX.Element | null {
  if (approvals.length === 0 && blocked.length === 0) return null;
  return (
    <Stack as="section" gap={4} aria-labelledby="today-needs-you-heading">
      <h2 id="today-needs-you-heading" className="text-on-surface text-title-medium font-semibold">
        Needs you
      </h2>
      <Group heading="Waiting on your approval" tasks={approvals} orgName={orgName} />
      <Group heading="Blocked" tasks={blocked} orgName={orgName} />
    </Stack>
  );
}
