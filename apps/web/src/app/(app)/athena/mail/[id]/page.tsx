'use client';

/** One message Athena received, read as a context object. */
import { useTypedRoute } from '@/lib/app-location';
import type { JSX } from 'react';

import { MailMessageView } from '@/components/athena/mail-message-view';

/**
 * The received-message route — the target of every permalink to an Athena email.
 *
 * @returns the message surface.
 */
export default function AthenaMailMessagePage(): JSX.Element {
  const params = useTypedRoute('/athena/mail/[id]').params;
  return <MailMessageView messageId={params.id} />;
}
