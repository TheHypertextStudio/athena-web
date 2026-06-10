import type { ProjectStatus } from '@docket/types';

/** Human label for each project lifecycle status. */
export const STATUS_LABEL: Record<string, string> = {
  planned: 'Planned',
  active: 'Active',
  completed: 'Completed',
  canceled: 'Canceled',
};

/** Badge variant for a project status: active is prominent, all others are muted. */
export function statusBadgeVariant(status: string): 'default' | 'secondary' {
  return status === 'active' ? 'default' : 'secondary';
}

const PROJECT_STATUSES = new Set<ProjectStatus>(['planned', 'active', 'completed', 'canceled']);

/** Narrow a wire `status` string to a {@link ProjectStatus}, defaulting to `planned`. */
export function projectStatusOf(status: string): ProjectStatus {
  return PROJECT_STATUSES.has(status as ProjectStatus) ? (status as ProjectStatus) : 'planned';
}
