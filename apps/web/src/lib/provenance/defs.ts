'use client';

/**
 * Reads behind the origin card: where an entity came from, and who the viewer is.
 *
 * @remarks
 * Both reads stay dormant until a person opens the card, so a detail page costs no request for a
 * fact nobody asked about. See `docs/engineering/specs/provenance.md` §3.
 */
import type { ProvenanceEntityKind } from '@docket/work/provenance-contract';

import { useOptionalResolvedAccountId } from '@/components/resolved-account';
import { api } from '@/lib/api';
import { STALE, apiQueryOptions, queryKeys, useApiQuery } from '@/lib/query';
import { orgMembersDef } from '@/lib/use-org-membership';

/** The entity an origin card answers for. */
export interface ProvenanceSubject {
  readonly kind: ProvenanceEntityKind;
  readonly id: string;
  readonly organizationId: string;
}

/**
 * Typed definition for one entity's provenance.
 *
 * @param subject - The entity to read.
 * @param enabled - Whether the card is open; the read waits until it is.
 * @returns query options for `GET /v1/orgs/:orgId/provenance/:kind/:id`.
 */
export function provenanceDef(subject: ProvenanceSubject, enabled: boolean) {
  const { kind, id, organizationId: orgId } = subject;
  return apiQueryOptions(
    queryKeys.provenance(orgId, kind, id),
    () => api.v1.orgs[':orgId'].provenance[':kind'][':id'].$get({ param: { orgId, kind, id } }),
    'Could not load where this came from.',
    { enabled, staleTime: STALE.volatile },
  );
}

/**
 * The viewer's actor in a workspace, so their own changes can read "You".
 *
 * @remarks
 * Resolved from the shell's account and the workspace roster, which every roster page already
 * holds, so this is normally a cache hit.
 *
 * @param orgId - The workspace.
 * @param enabled - Whether anything on screen needs the answer yet.
 * @returns the actor id, or null while unknown.
 */
export function useViewerActorId(orgId: string, enabled: boolean): string | null {
  const accountId = useOptionalResolvedAccountId();
  const members = useApiQuery({
    ...orgMembersDef(orgId),
    enabled: enabled && accountId !== null,
  });
  return members.data?.items.find((member) => member.userId === accountId)?.actorId ?? null;
}
