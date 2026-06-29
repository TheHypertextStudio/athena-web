import type { CycleOut, CycleStats } from '@docket/types';

import { api } from '@/lib/api';
import type { RpcResponse } from '@/lib/query-core';

/**
 * The cycles roster joined with each cycle's pace stats (from its single-cycle read).
 *
 * @remarks
 * `statsById` is a **plain record**, not a `Map`, on purpose: this view-model is dehydrated
 * across the RSC boundary for SSR hydration (see `cycles/page.tsx`), and a plain record
 * survives both JSON and React Flight serialization unchanged — a `Map` does not. Lookup is
 * still O(1); callers index by cycle id.
 */
export interface CyclesWithStats {
  readonly cycles: readonly CycleOut[];
  readonly statsById: Readonly<Record<string, CycleStats>>;
}

/**
 * Fetch the org's cycles and each cycle's pace stats, returning a {@link RpcResponse}-shaped
 * result so it can drive {@link useApiListQuery} directly (or be `unwrap`-ed for an SSR prefetch).
 *
 * @remarks
 * The cycles list endpoint returns each cycle's pace stats (committed/completed, capacity,
 * carryover) inline, so this reads them straight off the list items — no per-cycle `…/cycles/:id`
 * fan-out. The composite resolves `ok`/`status` from the gating list read.
 *
 * Before reading the roster it ensures each team's rolling window (past + current + upcoming)
 * exists — the `…/cycles/current` ensure is idempotent, so it is a cheap no-op once materialized,
 * and it means the page is never empty for a real team.
 *
 * @param orgId - The active org id.
 * @param teamIds - The org's team ids, in the order the roster keys off (must match server + client
 *   so an SSR-hydrated cache hits).
 * @param client - The RPC client; defaults to the browser client. The server passes its
 *   cookie-forwarding client for SSR prefetch.
 */
export function fetchCyclesWithStats(
  orgId: string,
  teamIds: readonly string[],
  client: typeof api = api,
): () => Promise<RpcResponse<CyclesWithStats>> {
  return async () => {
    await Promise.all(
      teamIds.map((teamId) =>
        client.v1.orgs[':orgId'].cycles.current
          .$get({ param: { orgId }, query: { teamId } })
          .catch(() => null),
      ),
    );
    const listRes = await client.v1.orgs[':orgId'].cycles.$get({ param: { orgId } });
    if (!listRes.ok) {
      return {
        ok: false,
        status: listRes.status,
        json: () => listRes.json() as unknown as Promise<CyclesWithStats>,
      };
    }
    const { items } = await listRes.json();
    const statsById: Record<string, CycleStats> = {};
    for (const item of items) {
      statsById[item.id] = item.stats;
    }
    return {
      ok: true,
      status: listRes.status,
      json: () => Promise.resolve({ cycles: items, statsById }),
    };
  };
}
