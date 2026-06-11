'use client';

import type { InitiativeCatalogRow } from '@/components/initiatives/initiative-catalog';
import type { RpcResponse } from '@/lib/query';
import { api } from '@/lib/api';
import type { InitiativeDetail, InitiativeOut } from '@docket/types';

/** Reduce an Initiative + its detail roll-up into the enriched row view-model. */
export function toEnriched(
  base: InitiativeOut,
  detail: InitiativeDetail | null,
): InitiativeCatalogRow {
  return {
    id: base.id,
    name: base.name,
    description: base.description ?? null,
    createdAt: base.createdAt,
    derivedStatus: detail?.derivedStatus ?? 'active',
    rolledUpHealth: detail?.rolledUpHealth ?? null,
    programCount: detail?.childMix.programs ?? 0,
    projectCount: detail?.childMix.projects ?? 0,
  };
}

/**
 * Fetch the org's initiatives and enrich each with its detail roll-up.
 *
 * The list endpoint returns only stored rows; each is joined with its detail read in
 * parallel. A failed detail read degrades to a benign default rather than failing the whole list.
 */
export function fetchEnrichedInitiatives(
  orgId: string,
): () => Promise<RpcResponse<readonly InitiativeCatalogRow[]>> {
  return async () => {
    const listRes = await api.v1.orgs[':orgId'].initiatives.$get({ param: { orgId } });
    if (!listRes.ok) {
      return {
        ok: false,
        status: listRes.status,
        json: () => listRes.json() as unknown as Promise<readonly InitiativeCatalogRow[]>,
      };
    }
    const { items } = await listRes.json();
    const enriched = await Promise.all(
      items.map(async (base): Promise<InitiativeCatalogRow> => {
        const detailRes = await api.v1.orgs[':orgId'].initiatives[':id'].$get({
          param: { orgId, id: base.id },
        });
        return toEnriched(base, detailRes.ok ? await detailRes.json() : null);
      }),
    );
    return { ok: true, status: listRes.status, json: () => Promise.resolve(enriched) };
  };
}
