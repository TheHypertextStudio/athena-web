/** `/focus` — an authenticated, chrome-free working companion. */
import type { Metadata } from 'next';
import type { JSX } from 'react';

import FocusImmersive from '@/components/time-tracking/focus-immersive';

/** Browser title for immersive Focus. */
export const metadata: Metadata = { title: 'Focus · Docket' };

/** Render the live immersive Focus experience. */
export default function FocusPage(): JSX.Element {
  return <FocusImmersive />;
}
