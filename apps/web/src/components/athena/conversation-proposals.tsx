'use client';

/** Pending proposal groups rendered in their conversation, beside the saved turn. */
import { type JSX, useEffect, useRef } from 'react';

import { ProposalGroupCard } from '@/components/agents/proposal-group-card';
import { useSessionDetail } from '@/lib/use-session-detail';

/** Props for {@link ChatProposals}. */
interface ChatProposalsProps {
  readonly orgId: string;
  readonly sessionId: string;
  readonly onSettled: () => Promise<void>;
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
        <ProposalGroupCard
          key={group.proposalGroupId}
          group={group}
          canAct
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
