import type { JSX } from 'react';

import OrgTasksClient from './org-tasks-client';

/** Render the server-executed organization Task roster. */
export default function OrgTasksPage(): JSX.Element {
  return <OrgTasksClient />;
}
