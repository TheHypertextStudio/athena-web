/** Which of an initiative's connected projects and programs the caller may view. */
import type { AuthSession } from '../context';
import { viewableResourceKeys } from '../permissions/resource-access';

/** A project or program row, by organization and id. */
export interface InitiativeWorkRow {
  readonly id: string;
  readonly organizationId: string;
}

/**
 * Resolve the access keys of the connected work the session's user may view.
 *
 * @param session - The caller's session; without a user nothing is viewable.
 * @param projects - The connected projects.
 * @param programs - The connected programs.
 * @returns the `resourceAccessKey` of every viewable project and program.
 */
export async function accessibleInitiativeWorkKeys(
  session: AuthSession,
  projects: readonly InitiativeWorkRow[],
  programs: readonly InitiativeWorkRow[],
): Promise<ReadonlySet<string>> {
  if (!session?.user) return new Set();
  return viewableResourceKeys(session.user.id, [
    ...projects.map((row) => ({
      organizationId: row.organizationId,
      kind: 'project',
      id: row.id,
    })),
    ...programs.map((row) => ({
      organizationId: row.organizationId,
      kind: 'program',
      id: row.id,
    })),
  ]);
}
