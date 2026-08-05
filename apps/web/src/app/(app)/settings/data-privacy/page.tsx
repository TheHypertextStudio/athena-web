import type { JSX } from 'react';

import DataPrivacyClient from './data-privacy-client';

/** The user-owned data export and deletion destination. */
export default function GlobalDataPrivacySettingsPage(): JSX.Element {
  return <DataPrivacyClient />;
}
