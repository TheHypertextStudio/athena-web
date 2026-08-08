'use client';

/**
 * `today/today-session` — the conversation, rendered where the prompt was.
 *
 * @remarks
 * The engaged half of Today. Starting something does not navigate: the prompt expands in place
 * into the one Athena conversation, and the rest of the page steps out of the way.
 *
 * **This is not a second conversation.** `AthenaConversation` reads the single persistent thread —
 * its own docblock calls itself "shared by every door onto the thread … so the conversation itself
 * is defined once and each door only supplies its own chrome", and `agent-dispatch.ts` is blunter:
 * "A person has exactly one open Athena session. Every entry point resolves to it; nothing opens a
 * second one." Today is one more door onto it, not a place that grows its own.
 *
 * That is also what makes the `Talk` control correct here rather than a second voice surface.
 * Voice is "an integrated mode of the single Athena session", and this *is* that session — so the
 * control belongs in this header the same way it belongs in the Athena workspace's.
 */
import { X } from '@docket/ui/icons';
import { Button, Stack } from '@docket/ui/primitives';
import type { JSX } from 'react';

import AthenaConversation from '@/components/athena/athena-conversation';
import { VoiceLaunch } from '@/components/athena/voice-launch';

/** Props for {@link TodaySession}. */
export interface TodaySessionProps {
  /** The workspace the conversation acts in. */
  readonly orgId: string;
  /** Leave the session and restore the resting page. */
  readonly onClose: () => void;
}

/** The conversation and its chrome, occupying the page while it is open. */
export default function TodaySession({ orgId, onClose }: TodaySessionProps): JSX.Element {
  return (
    // The shared name is what makes this a morph rather than a swap: the prompt carries the same
    // `view-transition-name`, so the browser animates one box growing into the other instead of
    // cross-fading two unrelated elements.
    <Stack gap={3} className="min-h-0 flex-1" style={{ viewTransitionName: 'today-composer' }}>
      <div className="flex shrink-0 items-center justify-between gap-2">
        <h2 className="text-on-surface text-title-medium font-semibold">Athena</h2>
        <div className="flex shrink-0 items-center gap-2">
          <VoiceLaunch workspaceId={orgId} />
          <Button
            variant="ghost"
            iconOnly
            controlSize="sm"
            aria-label="Close Athena"
            onClick={onClose}
          >
            <X />
          </Button>
        </div>
      </div>
      <AthenaConversation orgId={orgId} className="min-h-0 flex-1" />
    </Stack>
  );
}
