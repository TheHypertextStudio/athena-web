'use client';

/**
 * `settings/notion` — reopen Notion's consent screen.
 *
 * @remarks
 * Shared by the two states that need it: repairing a rejected credential, and picking pages to
 * share.
 */
import { Button } from '@docket/ui/primitives';
import type { JSX } from 'react';

import { authClient } from '@/lib/auth-client';

import { socialProviderForConnector } from '../integrations-config';

/** Props for {@link NotionConnectAction}. */
export interface NotionConnectActionProps {
  /** The action's label. */
  readonly label: string;
  /** Visual weight; `default` when this is the only way forward. */
  readonly variant?: 'default' | 'outline';
  /**
   * Whether the viewer may actually do this.
   *
   * @remarks
   * Every Notion write is guarded at `capabilityGuard('manage')`, so a member without it gets a
   * 403 from the route. Offering the control anyway advertises a capability they do not hold.
   */
  readonly disabled?: boolean;
}

/** Reopen Notion's consent screen, returning here afterwards. */
export function NotionConnectAction({
  label,
  variant = 'outline',
  disabled = false,
}: NotionConnectActionProps): JSX.Element {
  return (
    <Button
      variant={variant}
      disabled={disabled}
      onClick={() => {
        void authClient.linkSocial({
          provider: socialProviderForConnector('notion'),
          callbackURL: window.location.pathname,
        });
      }}
    >
      {label}
    </Button>
  );
}
