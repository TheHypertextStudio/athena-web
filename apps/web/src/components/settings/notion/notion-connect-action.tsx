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
}

/** Reopen Notion's consent screen, returning here afterwards. */
export function NotionConnectAction({
  label,
  variant = 'outline',
}: NotionConnectActionProps): JSX.Element {
  return (
    <Button
      variant={variant}
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
