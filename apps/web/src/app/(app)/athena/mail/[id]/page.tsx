'use client';

/** One message Athena received, read as a context object. */
import { useAppParams } from '@/lib/app-location';
import type { JSX } from 'react';

import { MailMessageView } from '@/components/athena/mail-message-view';

/**
 * The received-message route — the target of every permalink to an Athena email.
 *
 * @returns the message surface.
 */
export default function AthenaMailMessagePage(): JSX.Element {
  const params = useAppParams<{ id: string }>();
  return <MailMessageView messageId={params.id} />;
}
