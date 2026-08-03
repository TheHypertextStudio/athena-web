'use client';

/**
 * The control that puts voice mode one click from the conversation.
 *
 * @remarks
 * Deliberately a plain control in the Athena surface's own header, not an item in an overflow
 * menu and not a settings toggle: "reachable directly from the conversation" is the requirement,
 * and a mode you have to go looking for is a mode nobody uses. Opening it never navigates —
 * {@link VoiceMode} renders in place.
 */
import type { VoiceTurnOut } from '@docket/types';
import { Mic } from '@docket/ui/icons';
import { Button } from '@docket/ui/primitives';
import { type JSX, useState } from 'react';

import { VoiceMode } from './voice-mode';

/** Props for {@link VoiceLaunch}. */
export interface VoiceLaunchProps {
  /** Workspace the session acts in; omitted uses the personal workspace. */
  readonly workspaceId?: string | null;
  /** Recent conversation to show above the live turns. */
  readonly history?: readonly VoiceTurnOut[];
}

/**
 * The "Talk" control and the panel it opens.
 *
 * @param props - Workspace focus and the conversation so far.
 */
export function VoiceLaunch({ workspaceId, history }: VoiceLaunchProps): JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant="secondary"
        className="min-h-10"
        onClick={() => {
          setOpen(true);
        }}
        data-voice-launch
      >
        <Mic aria-hidden="true" />
        Talk
      </Button>
      <VoiceMode
        open={open}
        onOpenChange={setOpen}
        workspaceId={workspaceId ?? null}
        history={history ?? []}
      />
    </>
  );
}

export default VoiceLaunch;
