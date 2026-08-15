'use client';

/**
 * `settings/notion` — reopen Notion's consent screen from wherever the reader already is.
 *
 * @remarks
 * Two states on this surface need the same ceremony for different reasons: a connection whose
 * credential was rejected needs re-authorizing, and a connection that can see no pages needs the
 * consent screen's page picker. Both are `linkSocial` against the Notion provider, and both used to
 * be described in prose rather than offered — the hub's broken-connection alert named a Reconnect
 * button that existed only on the Connections list, one level up.
 *
 * Owning the call once matters more than the four lines it saves: `callbackURL` is what returns the
 * reader to the page they were repairing, and a second copy is a second chance to send somebody
 * back somewhere else.
 */
import { Button } from '@docket/ui/primitives';
import type { JSX } from 'react';

import { authClient } from '@/lib/auth-client';

import { socialProviderForConnector } from '../integrations-config';

/** Props for {@link NotionConnectAction}. */
export interface NotionConnectActionProps {
  /** The action's label — what this particular state is asking for. */
  readonly label: string;
  /** `default` for a state whose only way forward is this button. */
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
          // The pathname alone: this is a settings route, so it is deep-linkable and returning to
          // it lands the reader back on the connection they were repairing.
          callbackURL: window.location.pathname,
        });
      }}
    >
      {label}
    </Button>
  );
}
