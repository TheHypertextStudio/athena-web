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
import type { VoiceTurnOut } from '@docket/athena/voice';
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
  /**
   * Render the launch control as a bare icon button (`aria-label="Talk"`, no visible "Talk" text).
   *
   * @remarks
   * For a header row too narrow for a labeled button, e.g. the rail's fixed 40px header — the mic
   * glyph alone is legible there and the accessible name still says what the control does.
   */
  readonly iconOnly?: boolean;
}

/**
 * The "Talk" control and the panel it opens.
 *
 * @param props - Workspace focus, the conversation so far, and whether to render icon-only.
 */
export function VoiceLaunch({
  workspaceId,
  history,
  iconOnly = false,
}: VoiceLaunchProps): JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant="secondary"
        className={iconOnly ? undefined : 'min-h-10'}
        iconOnly={iconOnly}
        aria-label={iconOnly ? 'Talk' : undefined}
        title={iconOnly ? 'Talk' : undefined}
        onClick={() => {
          setOpen(true);
        }}
        data-voice-launch
      >
        <Mic aria-hidden="true" />
        {iconOnly ? null : 'Talk'}
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
