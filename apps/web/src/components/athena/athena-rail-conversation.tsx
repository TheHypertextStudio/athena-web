'use client';

/**
 * The rail's Athena panel: the one conversation, beside whatever the person is looking at.
 *
 * The header is the mark, Talk, and a way to the wide view. Between the header and the thread sits
 * the Working strip — every job still running or waiting, read from the same personal queue the
 * wide view's Work ledger reads. The body is the shared conversation with the page chip above its
 * composer and the same jobs merged into it as cards. An "open Athena" that carries an opening line
 * lands it in the composer; a route with its own subject (a plan) passes a shorter empty state.
 */
import { OpenInNew, Sparkles } from '@docket/ui/icons';
import { Button } from '@docket/ui/primitives';
import { type JSX } from 'react';

import AthenaConversation, {
  type ConversationEmptyState,
} from '@/components/athena/athena-conversation';
import { useAthenaPanel } from '@/components/athena/athena-panel-provider';
import { AthenaWorkingStrip } from '@/components/athena/athena-working-strip';
import { VoiceLaunch } from '@/components/athena/voice-launch';
import Link from '@/components/docket-link';
import { jobsFromQueue } from '@/lib/athena/job-presentation';
import type { PersonalAthenaSessionSummary } from '@/lib/athena/presentation';
import {
  athenaHref,
  personalAthenaQueueDef,
  personalAthenaTransport,
  type PersonalAthenaTransport,
} from '@/lib/athena/query-defs';
import { useLiveApiQuery } from '@/lib/query';

/** Props for {@link AthenaRailConversation}. */
export interface AthenaRailConversationProps {
  /** The workspace whose door the thread is read through. */
  readonly orgId: string;
  /** What an empty thread says; a route with its own subject passes a shorter one. */
  readonly emptyState?: ConversationEmptyState | undefined;
  /** Whether an empty thread offers prompts. Defaults to true. */
  readonly suggestions?: boolean | undefined;
  /** Transport the Working strip's queue read and its jobs' cards drive their actions through. */
  readonly transport?: PersonalAthenaTransport | undefined;
}

/** How often the rail re-reads the personal queue for the Working strip. */
const QUEUE_LIVE_INTERVAL_MS = 5_000;

/** Scroll a job's card into view, when its card is mounted. */
function scrollToJobCard(jobId: string): void {
  document.getElementById(`athena-job-${jobId}`)?.scrollIntoView({ block: 'center' });
}

/** The rail's Athena panel body. */
export function AthenaRailConversation({
  orgId,
  emptyState,
  suggestions = true,
  transport = personalAthenaTransport,
}: AthenaRailConversationProps): JSX.Element {
  const athena = useAthenaPanel();
  const draftRequest = athena.launchDraft;
  const queue = useLiveApiQuery(personalAthenaQueueDef(transport, true), QUEUE_LIVE_INTERVAL_MS);
  const jobs: readonly PersonalAthenaSessionSummary[] = queue.data ? jobsFromQueue(queue.data) : [];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex min-h-12 shrink-0 items-center gap-2 py-1 pr-1 pl-3">
        <Sparkles aria-hidden="true" className="text-primary size-4" />
        <span className="text-on-surface text-label-large min-w-0 flex-1 truncate">Athena</span>
        <VoiceLaunch workspaceId={orgId} />
        <Button variant="ghost" size="sm" iconOnly asChild>
          <Link
            href={athenaHref({ workspaceId: orgId })}
            aria-label="Open the Athena page"
            title="Open the Athena page"
          >
            <OpenInNew aria-hidden="true" className="size-4" />
          </Link>
        </Button>
      </div>
      <div className="px-3">
        <AthenaWorkingStrip jobs={jobs} transport={transport} onOpen={scrollToJobCard} />
      </div>
      <AthenaConversation
        orgId={orgId}
        className="min-h-0 flex-1 px-3 pb-3"
        draftRequest={draftRequest}
        context={athena.context}
        contextAttached={athena.contextAttached}
        onDetachContext={athena.detachContext}
        onAttachContext={athena.attachContext}
        suggestions={suggestions}
        jobs={jobs}
        transport={transport}
        {...(emptyState ? { emptyState } : {})}
      />
    </div>
  );
}
