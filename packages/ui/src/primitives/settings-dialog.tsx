'use client';

/**
 * `@docket/ui` — large modal-shell primitive (the settings modal's panel).
 *
 * @remarks
 * A compatibility name for the settings routes while they migrate to {@link DialogContent}. It
 * owns no geometry, scrim, focus handling, shape, padding, or overflow. Those are all supplied by
 * the shared responsive-fullscreen dialog presentation, which becomes a workspace-width modal on
 * desktop and a full compact viewport on mobile. Task 8 removes this alias after its remaining
 * call site moves to the named dialog slots.
 */
import * as React from 'react';

import { DialogContent, type DialogContentProps } from './dialog';

/**
 * The large, fixed-size modal panel (the visible settings-modal surface).
 *
 * @remarks
 * Delegates every visible and behavioral concern to {@link DialogContent}. This remains a small
 * compatibility wrapper only so existing settings callers can migrate independently of the
 * primitive contract.
 */
export function SettingsDialogContent({
  showClose = true,
  ...props
}: Omit<DialogContentProps, 'presentation' | 'closeLabel'> & {
  /** Render the built-in top-right close button (default `true`). */
  showClose?: boolean;
}): React.JSX.Element {
  return (
    <DialogContent
      {...props}
      presentation={{ kind: 'responsive-fullscreen', size: 'workspace', height: 'tall' }}
      showClose={showClose}
      closeLabel="Close settings"
    />
  );
}
