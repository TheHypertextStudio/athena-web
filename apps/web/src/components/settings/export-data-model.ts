import type { AccountExportOut, AccountExportScope } from '@docket/types';

/** Application-owned labels and descriptions for each selectable archive category. */
export const EXPORT_CATEGORY_COPY = {
  account: {
    title: 'Account information',
    description: 'Profile details, linked accounts, and apps you authorized.',
  },
  personal: {
    title: 'Personal Docket data',
    description: 'Plans, notifications, activity, digests, and items you follow.',
  },
  workspaces: {
    title: 'Workspace data',
    description: 'Projects, tasks, comments, updates, labels, teams, and saved views.',
  },
} as const;

/** A selectable top-level category in a personal-data archive. */
export type ExportCategory = keyof typeof EXPORT_CATEGORY_COPY;

/** The selection passed from the export form to the account-export mutation. */
export interface ExportRequestInput {
  /** Top-level data categories to include. */
  readonly categories: readonly ExportCategory[];
  /** Exact workspace ids to include when workspace data is selected. */
  readonly workspaceIds: readonly string[];
}

/** Render a concise summary of the persisted scope for an export-history row. */
export function exportScopeSummary(scope: AccountExportScope): string {
  return scope.categories
    .map((category) => {
      if (category !== 'workspaces') return EXPORT_CATEGORY_COPY[category].title;
      if (scope.allWorkspaces) return 'All workspaces';
      return `${scope.workspaces.length} workspace${scope.workspaces.length === 1 ? '' : 's'}`;
    })
    .join(' · ');
}

/** Describe an export lifecycle state without exposing worker implementation details. */
export function exportStatusCopy(exportJob: AccountExportOut): string {
  switch (exportJob.status) {
    case 'pending':
      return 'Preparing';
    case 'ready':
      return 'Your export is ready';
    case 'failed':
      return 'Could not be created';
    case 'expired':
      return 'Download link expired';
  }
}
