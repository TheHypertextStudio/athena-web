'use client';

/**
 * The rail's Athena panel: the one conversation, beside whatever the person is looking at.
 *
 * The header is the mark, Talk, and a way to the wide view. The body is the shared conversation
 * with the page chip above its composer. An "open Athena" that carries an opening line lands it in
 * the composer; a route with its own subject (a plan) passes a shorter empty state.
 */
import { OpenInNew, Sparkles } from '@docket/ui/icons';
import { Button } from '@docket/ui/primitives';
import type { JSX } from 'react';

import AthenaConversation, {
  type ConversationEmptyState,
} from '@/components/athena/athena-conversation';
import { useAthenaPanel } from '@/components/athena/athena-panel-provider';
import { VoiceLaunch } from '@/components/athena/voice-launch';
import Link from '@/components/docket-link';
import { athenaHref } from '@/lib/athena/query-defs';

/** Props for {@link AthenaRailConversation}. */
export interface AthenaRailConversationProps {
  /** The workspace whose door the thread is read through. */
  readonly orgId: string;
  /** What an empty thread says; a route with its own subject passes a shorter one. */
  readonly emptyState?: ConversationEmptyState | undefined;
  /** Whether an empty thread offers prompts. Defaults to true. */
  readonly suggestions?: boolean | undefined;
}

/** The rail's Athena panel body. */
export function AthenaRailConversation({
  orgId,
  emptyState,
  suggestions = true,
}: AthenaRailConversationProps): JSX.Element {
  const athena = useAthenaPanel();
  const draftRequest = athena.launchDraft;
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
      <AthenaConversation
        orgId={orgId}
        className="min-h-0 flex-1 px-3 pb-3"
        draftRequest={draftRequest}
        context={athena.context}
        contextAttached={athena.contextAttached}
        onDetachContext={athena.detachContext}
        onAttachContext={athena.attachContext}
        suggestions={suggestions}
        {...(emptyState ? { emptyState } : {})}
      />
    </div>
  );
}
