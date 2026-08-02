'use client';

/** Athena's inbox — the address people write to, and what has arrived there. */
import type { JSX } from 'react';

import { MailInbox } from '@/components/athena/mail-inbox';

/**
 * The Athena inbox route.
 *
 * @returns the inbox surface.
 */
export default function AthenaMailPage(): JSX.Element {
  return <MailInbox />;
}
