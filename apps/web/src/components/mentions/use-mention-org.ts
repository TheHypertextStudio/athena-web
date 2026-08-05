'use client';

/**
 * Decide which workspace an `@` menu searches.
 */
import { useActiveOrgIdOptional } from '@/components/active-org';

/**
 * Resolve the workspace a composer's mentions belong to.
 *
 * @remarks
 * A composer that already knows its workspace has to use that one. The Athena dock and the Today
 * capture box both open on routes with no `/orgs/:orgId` segment, so the route context resolves to
 * nothing there and `@` would quietly stay a plain character on surfaces the user reaches most
 * often. The route context is the fallback for a surface that genuinely has no workspace of its
 * own, such as a chat started before one was chosen.
 *
 * @param surfaceOrgId - The workspace this surface is about, when it knows one.
 * @returns The org to search, or undefined to leave `@` as an ordinary character.
 *
 * @example
 * ```typescript
 * const mentionOrgId = useMentionOrgId(session.workspace?.id);
 * ```
 */
export function useMentionOrgId(surfaceOrgId?: string | null): string | undefined {
  const routeOrgId = useActiveOrgIdOptional();
  return surfaceOrgId ?? routeOrgId ?? undefined;
}
