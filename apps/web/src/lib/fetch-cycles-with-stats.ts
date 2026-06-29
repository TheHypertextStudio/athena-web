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
 * Fetch the org's cycles with each cycle's pace stats, returning a {@link RpcResponse}-shaped
 * result so it can drive {@link useApiListQuery} directly (or be `unwrap`-ed for an SSR prefetch).
 *
 * @remarks
 * The cycles list endpoint returns each cycle's pace stats (committed/completed, capacity,
 * carryover) inline **and** auto-rolls each team's window server-side before listing, so this is a
 * single read — no per-cycle `…/cycles/:id` stats fan-out and no per-team `…/cycles/current` ensure
 * fan-out (which on the SSR path were T self-HTTP round-trips). The composite resolves `ok`/`status`
 * from the gating list read.
 *
 * @param orgId - The active org id.
 * @param client - The RPC client; defaults to the browser client. The server passes its
 *   cookie-forwarding client for SSR prefetch.
 */
export function fetchCyclesWithStats(
  orgId: string,
  client: typeof api = api,
): () => Promise<RpcResponse<CyclesWithStats>> {
  return async () => {
    // `roll=true`: the list endpoint auto-materializes every team's window in-process before
    // listing (one call), replacing the old per-team `/current` ensure fan-out.
    const listRes = await client.v1.orgs[':orgId'].cycles.$get({
      param: { orgId },
      query: { roll: 'true' },
    });
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
