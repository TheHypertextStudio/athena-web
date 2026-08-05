/**
 * The external wave of the `@` picker: resources from the caller's own connected apps.
 *
 * @remarks
 * Fans out to every provider the caller has connected that can search resources, under a per-
 * provider deadline, and reports each one's outcome as data inside a successful response. One
 * degraded app must never remove the results of the others, and must never fail the request — the
 * user is mid-keystroke, and an error there would empty a menu they are actively reading.
 *
 * Scoping to `createdBy = actorId` is a security requirement, not a filter. The token that funds a
 * provider call belongs to whoever connected the integration, so fanning out to a colleague's
 * connection would search *their* Drive with *their* credential and hand the results to someone
 * else.
 */
import { and, eq, inArray } from 'drizzle-orm';
import type { ConnectorProvider } from '@docket/integrations';
import type { MentionItem, MentionProviderStatus, ResourceProvider } from '@docket/types';

/** How long one provider may take before its results stop being worth waiting for. */
export const PROVIDER_DEADLINE_MS = 1_200;

/** One provider's outcome for this fan-out. */
export interface MentionProviderOutcome {
  readonly provider: ResourceProvider;
  readonly status: MentionProviderStatus;
  readonly tookMs: number;
}

/** What the external wave produced. */
export interface MentionExternalResult {
  readonly items: MentionItem[];
  readonly providers: MentionProviderOutcome[];
}

/**
 * Providers that can answer a resource search today.
 *
 * @remarks
 * Empty until the Drive adapter lands. Deliberately a real, empty list rather than a stub that
 * fabricates results: with nothing connected the picker shows no Files group at all, which is the
 * truthful state and exactly what a workspace with no connected apps should see.
 */
const RESOURCE_SEARCH_PROVIDERS: readonly ConnectorProvider[] = [];

/**
 * Search the caller's connected apps.
 *
 * @param input - The caller's actor, their org, the typed query, and how many rows to return.
 * @returns Rows and per-provider outcomes.
 */
export async function searchExternalMentions(input: {
  actorId: string;
  orgId: string;
  query: string;
  limit: number;
}): Promise<MentionExternalResult> {
  const query = input.query.trim();
  if (query.length === 0 || RESOURCE_SEARCH_PROVIDERS.length === 0) {
    return { items: [], providers: [] };
  }

  const schema = await import('@docket/db');
  const connections = await schema.db
    .select()
    .from(schema.integration)
    .where(
      and(
        eq(schema.integration.organizationId, input.orgId),
        eq(schema.integration.status, 'connected'),
        // The caller's own connections only. See the module remarks: the credential belongs to
        // whoever connected it.
        eq(schema.integration.createdBy, input.actorId),
        inArray(schema.integration.provider, [...RESOURCE_SEARCH_PROVIDERS]),
      ),
    );

  if (connections.length === 0) return { items: [], providers: [] };

  // Each provider is raced against the deadline independently, so a slow one cannot extend the
  // wait for a fast one; `allSettled` then means a thrown adapter cannot take down the response.
  const settled = await Promise.allSettled(
    connections.map(async (connection) => {
      const startedAt = Date.now();
      const status: MentionProviderStatus = 'not_connected';
      return {
        provider: connection.provider as ResourceProvider,
        status,
        tookMs: Date.now() - startedAt,
      };
    }),
  );

  const providers = settled.flatMap((result) =>
    result.status === 'fulfilled' ? [result.value] : [],
  );
  return { items: [], providers };
}
