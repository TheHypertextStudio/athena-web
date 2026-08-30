/** `/focus` — an authenticated, chrome-free working companion. */
import type { Metadata } from 'next';
import type { JSX } from 'react';

import FocusImmersive from '@/components/time-tracking/focus-immersive';
import { readServerSession } from '@/lib/server-session';

/** Browser title for immersive Focus. */
export const metadata: Metadata = { title: 'Focus · Docket' };

/** Render the live immersive Focus experience. */
export default async function FocusPage(): Promise<JSX.Element> {
  const session = await readServerSession();
  return <FocusImmersive userId={session.state === 'authenticated' ? session.user.userId : null} />;
}
