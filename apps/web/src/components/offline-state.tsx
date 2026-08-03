'use client';

import { EmptyState } from '@docket/ui/components';
import { CloudOff } from '@docket/ui/icons';
import { Button } from '@docket/ui/primitives';
import type { JSX } from 'react';

/**
 * The offline surfaces: a persistent in-shell banner, and a standalone screen for the case where
 * the shell cannot be rendered at all.
 *
 * @remarks
 * Both exist because Docket is installable, and an installed app is launched in situations a
 * browser tab never is — on a plane, in a lift, on a train through a tunnel. The old behaviour in
 * those situations was to fail as though the person had been signed out, which is both wrong and
 * insulting.
 *
 * Copy here is application-owned and says only what is actually known. It never claims the session
 * expired (the server was never reached, so that is unknown) and never blames the person. Per the
 * repository error-source policy, no exception text reaches this file at all.
 */

/** Props for {@link OfflineBanner}. */
interface OfflineBannerProps {
  /** Whether the browser reports a connection — the wording differs, the state does not. */
  readonly online: boolean;
  /** Re-ask the server for the session. */
  readonly onRetry: () => void;
}

/**
 * The persistent banner shown while the shell is rendering from cached data.
 *
 * @remarks
 * Deliberately not dismissible. It is the standing disclosure that everything on screen may be
 * stale — dismissing it would leave someone editing against a snapshot with no indication anything
 * is wrong. It is also the reason the offline shell is honest rather than a lie: it is visible for
 * the entire time a cached identity is standing in for a live session.
 *
 * The second sentence used to read "Changes can't be saved until you reconnect." That was true when
 * an offline write failed outright, and became false the moment writes were queued: they are saved,
 * on this device, and sent on reconnect. The copy now says so, and `OfflineSyncIndicator` (rendered
 * directly beneath this, from the same banner slot) lists the individual changes with their own
 * pending markers. The two must stay in step — a promise here that the queue does not keep would be
 * worse than the pessimism it replaced.
 *
 * Rendered in the shell's `banner` slot (a sibling of `<main>`, not page content) so it never
 * disturbs a page's `h-full` sizing.
 */
export function OfflineBanner({ online, onRetry }: OfflineBannerProps): JSX.Element {
  return (
    <div
      role="status"
      aria-live="polite"
      className="border-outline-variant bg-surface-container-high text-on-surface text-body-medium flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border px-3 py-2"
    >
      <CloudOff aria-hidden="true" className="text-on-surface-variant size-4 shrink-0" />
      <span className="font-medium">{online ? "Can't reach Docket" : "You're offline"}</span>
      <span className="text-on-surface-variant min-w-0 flex-1">
        Showing what was loaded earlier. Changes you make are saved on this device and sync
        automatically once you're back online.
      </span>
      <Button variant="outline" size="sm" onClick={onRetry}>
        Try again
      </Button>
    </div>
  );
}

/** Props for {@link OfflineContent}. */
interface OfflineContentProps {
  /** Whether the browser reports a connection. */
  readonly online: boolean;
  /** Re-ask the server for the session, if a retry is available. */
  readonly onRetry?: (() => void) | undefined;
}

/**
 * The content-region offline state, used when the server is unreachable and there is no cached
 * identity to populate a workspace with.
 *
 * @remarks
 * This deliberately renders **inside** `<main>` rather than replacing the application. An earlier
 * version was a `min-h-dvh` takeover, and that was wrong: it threw away the navigation, the
 * settings information architecture, the command palette, and any surface that had cached data —
 * none of which need a network. Losing a session lookup is not a reason to lose the whole product.
 *
 * It also never blames the person or claims the session expired. The server was not reached, so
 * that is simply unknown.
 */
export function OfflineContent({ online, onRetry }: OfflineContentProps): JSX.Element {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="w-full max-w-md">
        <EmptyState
          icon={CloudOff}
          title={online ? "Can't reach Docket" : "You're offline"}
          body={
            online
              ? "Docket isn't responding, so your workspace can't be loaded yet. Your work is safe — this is a connection problem, not a sign-out."
              : 'Your workspace will load once you reconnect. Nothing has been lost.'
          }
          {...(onRetry ? { cta: { label: 'Try again', onClick: onRetry } } : {})}
        />
      </div>
    </div>
  );
}
