'use client';

/** Pending proposal groups rendered in their conversation, beside the saved turn. */
import { type JSX, useEffect, useRef } from 'react';
import type { ProposalGroupOut } from '@docket/athena/agent-contract';

import {
  ProposalGroupCard,
  type ProposalGroupCardProps,
} from '@/components/agents/proposal-group-card';
import { useSessionDetail } from '@/lib/use-session-detail';
import { taskDetailDef } from '@/lib/use-task-detail';
import { useApiQuery } from '@/lib/query';
import { UserFacingError } from '@/lib/problem';

/** Props for {@link ChatProposals}. */
interface ChatProposalsProps {
  readonly orgId: string;
  readonly sessionId: string;
  readonly onSettled: () => Promise<void>;
}

/** A missing or inaccessible task makes the proposal stale; other reads can be retried. */
function unavailableTarget(error: unknown): 'missing' | 'temporary' {
  if (error instanceof UserFacingError && (error.status === 403 || error.status === 404)) {
    return 'missing';
  }
  return 'temporary';
}

/** Check a single task target before showing an executable approval. */
function CheckedProposalGroup({
  orgId,
  group,
  pending,
  onDecide,
  onEdit,
}: {
  readonly orgId: string;
  readonly group: ProposalGroupOut;
  readonly pending: boolean;
  readonly onDecide: ProposalGroupCardProps['onDecide'];
  readonly onEdit: ProposalGroupCardProps['onEdit'];
}): JSX.Element {
  const single = group.items.length === 1 ? group.items[0] : undefined;
  const taskId =
    single?.tool === 'update_task' && typeof single.input['taskId'] === 'string'
      ? single.input['taskId']
      : null;
  const task = useApiQuery({
    ...taskDetailDef(orgId, taskId ?? ''),
    enabled: taskId !== null,
  });
  return (
    <ProposalGroupCard
      group={group}
      canAct
      pending={pending}
      target={
        taskId
          ? {
              title: task.data?.title ?? null,
              href: `/orgs/${orgId}/tasks/${taskId}`,
              loading: task.isPending,
              unavailable: task.isError ? unavailableTarget(task.error) : null,
              retry: () => {
                void task.refetch();
              },
            }
          : undefined
      }
      onDecide={onDecide}
      onEdit={onEdit}
    />
  );
}

/** The in-thread ghost review: the thread's pending batches, decidable in place. */
export function ChatProposals({
  orgId,
  sessionId,
  onSettled,
}: ChatProposalsProps): JSX.Element | null {
  const { proposals, decideGroup, editProposal, controlPending } = useSessionDetail(
    orgId,
    sessionId,
  );
  const groupRef = useRef<HTMLDivElement | null>(null);

  // The proposal group loads via its own fetch, after the thread's scroll-to-end has already run,
  // so without this the pending approval would render below the fold.
  useEffect(() => {
    if (proposals.length > 0) groupRef.current?.scrollIntoView({ block: 'end' });
  }, [proposals.length]);

  if (proposals.length === 0) return null;
  return (
    <div ref={groupRef} className="flex flex-col gap-3">
      {proposals.map((group) => (
        <CheckedProposalGroup
          key={group.proposalGroupId}
          orgId={orgId}
          group={group}
          pending={controlPending}
          onDecide={(groupId, decision, activityIds) => {
            void decideGroup(groupId, decision, activityIds).then(onSettled);
          }}
          onEdit={(activityId, input) => {
            void editProposal(activityId, input);
          }}
        />
      ))}
    </div>
  );
}
