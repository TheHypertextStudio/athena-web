import type { OrgCreate, OrgCreateResult } from '@docket/types';

import { api } from '@/lib/api';
import { unwrap } from '@/lib/query';

/** The single app route for creating another shared workspace. */
export const CREATE_WORKSPACE_PATH = '/workspaces/new';

/**
 * Create a workspace through the typed organizations RPC.
 *
 * @param body - The validated organization-create payload.
 * @returns the created workspace and its seeded owner/default-team records.
 * @throws {Error} with the server's problem detail when creation fails.
 */
export function createWorkspace(body: OrgCreate): Promise<OrgCreateResult> {
  return unwrap(
    () => api.v1.orgs.$post({ json: body }),
    'Could not finish setting up your workspace. Please try again.',
  );
}
