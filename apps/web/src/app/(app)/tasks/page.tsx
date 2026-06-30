import type { JSX } from 'react';

import AllTasksClient from './all-tasks-client';

/**
 * The cross-workspace **Tasks** page (Home / cross-org level).
 *
 * @remarks
 * A singular place for the caller's work across *every* workspace — the missing companion to the
 * per-workspace `My Work`. The list is composed client-side by fanning the existing per-org task
 * query over the caller's workspaces (see {@link AllTasksClient}), so it needs no new endpoint.
 */
export default function TasksPage(): JSX.Element {
  return <AllTasksClient />;
}
