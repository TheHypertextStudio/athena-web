/** Which personal Athena work one overview read covers. */
import { agentSession } from '@docket/db';
import { eq, ne, type SQL } from 'drizzle-orm';

/** One owner's delegated work, optionally narrowed to the work started in one workspace. */
export interface AthenaWorkScope {
  readonly ownerUserId: string;
  /** The workspace the work was started in; omit for every workspace. */
  readonly workspaceId?: string | undefined;
}

/**
 * The conditions every queue lane and count shares.
 *
 * @remarks
 * The caller's own conversation (`kind: 'chat'`) is surfaced separately as `currentChat`, never as
 * a piece of work, so it is excluded here: it must not land in a lane or inflate a count.
 *
 * @param scope - The owner and optional workspace.
 * @returns conditions to spread into an `and(…)`.
 */
export function athenaWorkConditions(scope: AthenaWorkScope): SQL[] {
  return [
    eq(agentSession.executorKind, 'athena'),
    eq(agentSession.ownerUserId, scope.ownerUserId),
    ne(agentSession.kind, 'chat'),
    ...(scope.workspaceId === undefined
      ? []
      : [eq(agentSession.contextOrganizationId, scope.workspaceId)]),
  ];
}
