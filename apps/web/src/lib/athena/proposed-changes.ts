'use client';

/**
 * Task ids with a pending proposed change, mapped to the plain-English sentence describing it —
 * the source of a project page's ghost rows.
 *
 * @remarks
 * A change can be waiting for the person in two places: their own conversation (while it sits
 * `awaiting_approval`) and any job in their `needs_you` lane. Both are read here and folded into
 * one map, keyed by the task each proposal targets, so `TaskTable` can ghost the right rows no
 * matter which door proposed the change.
 */
import type { ProposalGroupOut, ProposalItemOut } from '@docket/athena/agent-contract';
import { useQueries } from '@tanstack/react-query';
import { useMemo } from 'react';

import { useApiQuery, useLiveApiQuery } from '@/lib/query';

import { orgSessionProposalsDef, useOrgChatThread } from './chat-defs';
import { describeProposal } from './describe-proposal';
import type { PersonalAthenaSessionSummary } from './presentation';
import {
  personalAthenaProposalsDef,
  personalAthenaQueueDef,
  personalAthenaTransport,
  type PersonalAthenaTransport,
} from './query-defs';

/** How often the personal queue is re-polled while a project page is computing ghost rows. */
const QUEUE_POLL_MS = 10_000;

/** Tool names whose proposal targets one already-existing task by id. */
const TASK_ROW_TOOLS: ReadonlySet<string> = new Set(['update_task', 'delete_task']);

/** The target task id of one proposal item, or `null` when its tool does not name one. */
function targetTaskId(item: ProposalItemOut): string | null {
  if (!TASK_ROW_TOOLS.has(item.tool)) return null;
  const taskId = item.input['taskId'];
  return typeof taskId === 'string' ? taskId : null;
}

/** Whether a `needs_you` job belongs to the workspace whose project page is asking for ghost rows. */
function jobBelongsToWorkspace(job: PersonalAthenaSessionSummary, orgId: string): boolean {
  return job.workspace?.id === orgId || job.context?.workspaceId === orgId;
}

/** Fold every task-targeting item of the given groups into the accumulating sentence map. */
function collectTaskProposals(
  map: Map<string, string>,
  groups: readonly ProposalGroupOut[] | undefined,
): void {
  for (const group of groups ?? []) {
    for (const item of group.items) {
      const taskId = targetTaskId(item);
      if (taskId !== null) map.set(taskId, describeProposal(item));
    }
  }
}

/**
 * Every task id with a pending proposed change, mapped to the sentence {@link describeProposal}
 * renders for it.
 *
 * @remarks
 * Reads two sources: the workspace's persistent chat thread, while it sits `awaiting_approval`
 * (through {@link orgSessionProposalsDef} rather than the heavier `useSessionDetail`, which this
 * hook has no other use for), and every job in the `needs_you` lane of the personal queue that
 * belongs to this workspace (through the personal proposals route, one read per job via
 * {@link useQueries}). The queue itself is still read for every job system-wide — it shares
 * `queryKeys.athena()` with the rail's own read, so TanStack Query dedupes the two callers onto one
 * request — but only the jobs whose `workspace.id` or `context.workspaceId` matches `orgId` fan out
 * a `proposals` request; a `needs_you` job in another workspace never does. Only `update_task` and
 * `delete_task` proposals — the ones that target one existing task by id — produce a row; a
 * `create_task` ghost has no existing row to attach to.
 *
 * @param orgId - The active workspace, whose persistent chat thread is read for its own proposals,
 * and whose jobs alone fan out a proposals read.
 * @param transport - Override for the personal Athena queue/proposal reads (tests only).
 * @returns task id -> {@link describeProposal} sentence, for the tasks a `TaskTable` should ghost.
 */
export function useProposedTaskChanges(
  orgId: string,
  transport: PersonalAthenaTransport = personalAthenaTransport,
): ReadonlyMap<string, string> {
  const thread = useOrgChatThread(orgId).data;
  const awaitingThreadId = thread?.status === 'awaiting_approval' ? thread.id : null;
  const threadProposals = useApiQuery(
    orgSessionProposalsDef(orgId, awaitingThreadId ?? '', awaitingThreadId !== null),
  );

  const queue = useLiveApiQuery(personalAthenaQueueDef(transport), QUEUE_POLL_MS);
  const needsYouIds = useMemo(
    () =>
      (queue.data?.sessions.needsYou ?? [])
        .filter((job) => jobBelongsToWorkspace(job, orgId))
        .map((job) => job.id),
    [queue.data, orgId],
  );
  const jobProposals = useQueries({
    queries: needsYouIds.map((sessionId) => personalAthenaProposalsDef(sessionId, transport)),
  });

  return useMemo(() => {
    const map = new Map<string, string>();
    collectTaskProposals(map, threadProposals.data?.items);
    for (const result of jobProposals) {
      collectTaskProposals(map, result.data);
    }
    return map;
  }, [threadProposals.data, jobProposals]);
}
