/**
 * The external wave of the `@` picker: resources from the caller's own connected sources.
 *
 * @remarks
 * Fans out to every connection whose connector offers the resource-search capability, under a
 * per-source deadline, and reports each outcome as data inside a successful response. One degraded
 * source must never remove another's results, and must never fail the request — the user is
 * mid-keystroke, and an error there empties a menu they are reading.
 *
 * Nothing here names a source. Which connections participate comes from the capability the
 * connector declares, so adding OneDrive or Notion is an adapter plus a manifest entry.
 *
 * Scoping to `createdBy = actorId` is a security requirement, not a filter: the credential funding
 * a call belongs to whoever connected the integration, so fanning out to a colleague's connection
 * would search *their* account with *their* credential and hand the results to someone else.
 */
import { and, eq } from 'drizzle-orm';
import {
  PROVIDER_CATALOG,
  type ConnectorProviderId,
} from '@docket/connections/provider-catalog-contract';
import { ResourceProvider } from '@docket/connections/resource-provider-contract';
import { mentionRefKey, type MentionItem, type MentionProviderStatus } from '../contracts/mention';
import { ConnectorError, type ExternalResource } from '@docket/integrations';

import { createConnectorGateway, type ConnectorGateway } from './connector-gateway';

/** How long one source may take before its results stop being worth waiting for. */
export const PROVIDER_DEADLINE_MS = 1_200;

/** One source's outcome for this fan-out. */
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

/** What the external picker wave needs to fan out. */
export interface ExternalMentionQuery {
  /** How to reach connected sources. Injected, so this is testable without HTTP wiring. */
  readonly gateway?: ConnectorGateway;
  /** The Actor whose own connections are searched, and whose credentials fund the calls. */
  readonly actorId: string;
  /** The workspace those connections belong to. */
  readonly orgId: string;
  /** What has been typed after the `@`. */
  readonly query: string;
  /** How many rows to return. */
  readonly limit: number;
}

/** One source's contribution to the fan-out. */
interface SourceOutcome {
  readonly outcome: MentionProviderOutcome;
  readonly resources: readonly ExternalResource[];
}

/** Map a connector failure onto the closed status enum the client branches on. */
function statusForError(err: unknown): MentionProviderStatus {
  if (err instanceof ConnectorError) {
    if (err.kind === 'auth') return 'reauth_required';
    if (err.kind === 'rate_limit') return 'throttled';
    return 'unavailable';
  }
  if (err instanceof Error && err.name === 'TimeoutError') return 'timed_out';
  return 'unavailable';
}

/**
 * The resource-provider id a connector's results belong to.
 *
 * @remarks
 * Parsed rather than cast: the two enums overlap but are not the same set, and a connector whose
 * source system is not a resource provider falls back to the generic label instead of asserting a
 * membership that is not there.
 */
function resourceProviderFor(provider: ConnectorProviderId): ResourceProvider {
  const parsed = ResourceProvider.safeParse(PROVIDER_CATALOG[provider].sourceSystem);
  return parsed.success ? parsed.data : 'web';
}

/** Project one source result into a picker row. */
function toMentionItem(resource: ExternalResource): MentionItem {
  const ref = { kind: 'external', url: resource.url } as const;
  return {
    origin: 'external',
    id: mentionRefKey(ref),
    ref,
    provider: resource.provider,
    resourceType: resource.resourceType,
    title: resource.title,
    // One line of context, ordered by what orients fastest: who owns it, then where it lives.
    subtitle: resource.ownerLabel ?? resource.containerLabel ?? null,
    url: resource.url,
    iconUrl: resource.iconUrl ?? null,
    modifiedAt: resource.modifiedAt ?? null,
    score: 0,
  };
}

/** Search one connection, returning undefined when its source is not searchable at all. */
async function searchOneSource(
  input: ExternalMentionQuery,
  gateway: ConnectorGateway,
  connection: { id: string; provider: string },
  query: string,
): Promise<SourceOutcome | undefined> {
  const provider = connection.provider as ConnectorProviderId;
  const resourceProvider = resourceProviderFor(provider);
  const startedAt = Date.now();

  const access = await gateway.openResourceSearch(input.actorId, provider);
  if (!access.ok) {
    // An absent capability is not a failure: most connected sources simply are not searchable, and
    // reporting them would fill the menu's footer with status nobody can act on.
    if (access.reason === 'not_searchable') return undefined;
    return {
      outcome: {
        provider: resourceProvider,
        status: access.reason === 'needs_reauth' ? 'reauth_required' : 'not_connected',
        tookMs: Date.now() - startedAt,
      },
      resources: [],
    };
  }

  try {
    const page = await access.search.searchResources({
      connectionId: connection.id,
      query,
      limit: input.limit,
      signal: AbortSignal.timeout(PROVIDER_DEADLINE_MS),
    });
    return {
      outcome: { provider: resourceProvider, status: 'ok', tookMs: Date.now() - startedAt },
      resources: page.resources,
    };
  } catch (err) {
    return {
      outcome: {
        provider: resourceProvider,
        status: statusForError(err),
        tookMs: Date.now() - startedAt,
      },
      resources: [],
    };
  }
}

/**
 * Search the caller's connected sources.
 *
 * @param input - The caller's actor, their org, the typed query, and how many rows to return.
 * @returns Rows and per-source outcomes.
 */
export async function searchExternalMentions(
  input: ExternalMentionQuery,
): Promise<MentionExternalResult> {
  const query = input.query.trim();
  if (query.length === 0) return { items: [], providers: [] };

  const gateway = input.gateway ?? createConnectorGateway();
  const schema = await import('@docket/db');
  const connections = await schema.db
    .select()
    .from(schema.integration)
    .where(
      and(
        eq(schema.integration.organizationId, input.orgId),
        eq(schema.integration.status, 'connected'),
        // The caller's own connections only. See the module remarks.
        eq(schema.integration.createdBy, input.actorId),
      ),
    );

  if (connections.length === 0) return { items: [], providers: [] };

  // Each source is raced against the deadline independently, so a slow one cannot extend the wait
  // for a fast one; `allSettled` then means a thrown adapter cannot take down the response.
  const settled = await Promise.allSettled(
    connections.map((connection) => searchOneSource(input, gateway, connection, query)),
  );

  const providers: MentionProviderOutcome[] = [];
  const items: MentionItem[] = [];
  const seen = new Set<string>();

  for (const result of settled) {
    if (result.status !== 'fulfilled' || result.value === undefined) continue;
    providers.push(result.value.outcome);
    for (const resource of result.value.resources) {
      const item = toMentionItem(resource);
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      items.push(item);
    }
  }

  return { items, providers };
}
