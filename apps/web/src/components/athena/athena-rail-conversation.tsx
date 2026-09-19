'use client';

/**
 * The rail's Athena panel: the one conversation, beside whatever the person is looking at.
 *
 * @remarks
 * Two fixed regions only: a 40px header (the mark, Talk, and a way to the wide view) and the
 * composer, pinned at the bottom by {@link AthenaConversation}. Everything else — including which
 * jobs are running — lives in the scrolling thread itself, as job entries with their own status
 * line and collapsed steps; nothing is duplicated in a second, pinned strip above it. The one
 * exception is a single line under the header, shown only while a job is waiting on the person: a
 * ghost button naming how many and scrolling the thread to the first one's card.
 *
 * The mark-and-name row is dropped while the mobile utility {@link Sheet} hosts this panel — that
 * sheet already shows "Athena" in its own title row, and painting this row too gave the compact
 * width two headers for one panel. {@link useRailPresentation} is how this learns which host it is
 * in; Talk and the link to the wide view stay put either way, since the sheet's title row supplies
 * neither.
 */
import { OpenInNew, Sparkles } from '@docket/ui/icons';
import { cn } from '@docket/ui/lib/utils';
import { Button } from '@docket/ui/primitives';
import { useRailPresentation } from '@docket/ui/components';
import { type JSX } from 'react';

import AthenaConversation, {
  type ConversationEmptyState,
} from '@/components/athena/athena-conversation';
import { useAthenaPanel } from '@/components/athena/athena-panel-provider';
import { VoiceLaunch } from '@/components/athena/voice-launch';
import Link from '@/components/docket-link';
import { jobsFromQueue, jobsNeedingYou, needsYouLabel } from '@/lib/athena/job-presentation';
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
  /** Transport the queue read and the thread's job cards drive their actions through. */
  readonly transport?: PersonalAthenaTransport | undefined;
}

/** How often the rail re-reads the personal queue for the "needs you" line. */
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
  const waiting = jobsNeedingYou(jobs);
  const firstWaitingJob = waiting[0];
  const presentation = useRailPresentation();
  const hostSuppliesHeader = presentation === 'sheet';

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        data-slot="athena-rail-header"
        data-testid="athena-rail-header"
        className="flex h-10 shrink-0 items-center gap-2 pr-1 pl-4"
      >
        {hostSuppliesHeader ? null : (
          <>
            <Sparkles aria-hidden="true" className="text-primary size-4" />
            <span className="text-on-surface text-label-large min-w-0 flex-1 truncate">Athena</span>
          </>
        )}
        <div className={cn('flex items-center gap-1', hostSuppliesHeader && 'ml-auto')}>
          <VoiceLaunch workspaceId={orgId} iconOnly />
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
      </div>
      {firstWaitingJob ? (
        <div data-slot="athena-rail-needs-you" className="shrink-0 px-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              scrollToJobCard(firstWaitingJob.id);
            }}
          >
            {needsYouLabel(waiting.length)}
          </Button>
        </div>
      ) : null}
      <AthenaConversation
        orgId={orgId}
        className="min-h-0 flex-1 px-4 pb-4"
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
