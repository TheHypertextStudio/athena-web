'use client';

/**
 * The rail's Athena panel: the one conversation, beside whatever the person is looking at.
 *
 * @remarks
 * Two fixed regions only: a 44px header and the composer, pinned at the bottom by
 * {@link AthenaConversation}. The header answers "what is this about?" — the page chip on the left,
 * Talk and the way to the wide view on the right — and carries no name or glyph: the activity-bar
 * icon and the sheet's own title already name the panel. Everything else lives in the scrolling
 * thread, including a floating jump to work waiting on the person when it is scrolled away.
 *
 * While the mobile utility sheet hosts this panel, the header's controls move into the sheet's own
 * title bar ({@link useRailSheetBarSlot}), so the compact width paints one header row.
 *
 * The thread holds only this workspace's work that belongs here: work started from this page (its
 * source is the page's), or started while this conversation was open. Everything else is history,
 * and history lives in the Work ledger on the wide view.
 */
import { OpenInNew } from '@docket/ui/icons';
import { Button } from '@docket/ui/primitives';
import { useRailPresentation, useRailSheetBarSlot } from '@docket/ui/components';
import { type JSX, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';

import AthenaConversation, {
  type ConversationEmptyState,
} from '@/components/athena/athena-conversation';
import { AthenaContextChip } from '@/components/athena/athena-context-chip';
import { useAthenaPanel } from '@/components/athena/athena-panel-provider';
import { VoiceLaunch } from '@/components/athena/voice-launch';
import Link from '@/components/docket-link';
import { jobsFromQueue, threadJobs } from '@/lib/athena/job-presentation';
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
  /** The workspace whose conversation and work the panel shows. */
  readonly orgId: string;
  /** A one-line label for an empty thread, from a route with its own subject. */
  readonly emptyState?: ConversationEmptyState | undefined;
  /** Whether an empty thread offers prompts. Defaults to true. */
  readonly suggestions?: boolean | undefined;
  /** Transport the queue read and the thread's work entries drive their actions through. */
  readonly transport?: PersonalAthenaTransport | undefined;
}

/** How often the rail re-reads the workspace's queue. */
const QUEUE_LIVE_INTERVAL_MS = 5_000;

/** The job ids a workspace's first queue read held — everything after it started here. */
interface QueueBaseline {
  readonly orgId: string;
  readonly ids: ReadonlySet<string>;
}

/**
 * The ids of jobs started while this conversation has been open in `orgId`.
 *
 * @remarks
 * The first queue read for a workspace is the baseline; any job that appears after it was started
 * while the panel was open — from this conversation, or from a menu entry beside it. The baseline
 * is taken again when the workspace changes. Stored in state (set during render when the workspace
 * changes) so it survives re-renders without an effect.
 */
function useJobsStartedHere(
  orgId: string,
  jobs: readonly PersonalAthenaSessionSummary[] | null,
): ReadonlySet<string> {
  const [baseline, setBaseline] = useState<QueueBaseline | null>(null);
  if (jobs !== null && baseline?.orgId !== orgId) {
    setBaseline({ orgId, ids: new Set(jobs.map((job) => job.id)) });
  }
  return useMemo(() => {
    if (jobs === null || baseline?.orgId !== orgId) return new Set<string>();
    return new Set(jobs.filter((job) => !baseline.ids.has(job.id)).map((job) => job.id));
  }, [baseline, jobs, orgId]);
}

/** Props for {@link RailHeaderControls}. */
interface RailHeaderControlsProps {
  readonly orgId: string;
}

/** The header's contents: the page chip, then Talk and the link to the wide view. */
function RailHeaderControls({ orgId }: RailHeaderControlsProps): JSX.Element {
  const athena = useAthenaPanel();
  return (
    <>
      <div className="flex min-w-0 flex-1 items-center">
        <AthenaContextChip
          context={athena.context}
          attached={athena.contextAttached}
          onDetach={athena.detachContext}
          onAttach={athena.attachContext}
        />
      </div>
      <VoiceLaunch workspaceId={orgId} iconOnly />
      <Button variant="ghost" controlSize="md" iconOnly asChild>
        <Link
          href={athenaHref({ workspaceId: orgId })}
          aria-label="Open the Athena page"
          title="Open the Athena page"
        >
          <OpenInNew aria-hidden="true" />
        </Link>
      </Button>
    </>
  );
}

/**
 * The 44px header, or — inside the mobile sheet — the same controls portalled into the sheet's
 * title bar, so there is never a second header row.
 */
function RailHeader({ orgId }: RailHeaderControlsProps): JSX.Element | null {
  const sheetBar = useRailSheetBarSlot();
  const inSheet = useRailPresentation() === 'sheet';
  if (inSheet) {
    return sheetBar ? createPortal(<RailHeaderControls orgId={orgId} />, sheetBar) : null;
  }
  return (
    <div
      data-slot="athena-rail-header"
      data-testid="athena-rail-header"
      className="flex h-11 shrink-0 items-center gap-1 px-4"
    >
      <RailHeaderControls orgId={orgId} />
    </div>
  );
}

/** The rail's Athena panel body. */
export function AthenaRailConversation({
  orgId,
  emptyState,
  suggestions = true,
  transport = personalAthenaTransport,
}: AthenaRailConversationProps): JSX.Element {
  const athena = useAthenaPanel();
  const queue = useLiveApiQuery(
    personalAthenaQueueDef(transport, true, orgId),
    QUEUE_LIVE_INTERVAL_MS,
  );
  const workspaceJobs = useMemo(
    () => (queue.data ? jobsFromQueue(queue.data) : null),
    [queue.data],
  );
  const startedHere = useJobsStartedHere(orgId, workspaceJobs);
  const pageSource = athena.context?.source;
  const jobs = useMemo(
    () => threadJobs(workspaceJobs ?? [], pageSource, startedHere),
    [workspaceJobs, pageSource, startedHere],
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <RailHeader orgId={orgId} />
      <AthenaConversation
        orgId={orgId}
        className="min-h-0 flex-1 px-4 pb-4"
        draftRequest={athena.launchDraft}
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
