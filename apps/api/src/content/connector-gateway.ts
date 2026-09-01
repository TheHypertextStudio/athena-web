/**
 * How the mention slice reaches a connected source.
 *
 * @remarks
 * Stated as a port because the alternative was worse: `mention-external.ts` imported
 * `connectorFor` and `resolveConnectorToken` from `../routes/integration-provider`, which makes a
 * service depend on a route module — the wrong direction, and the reason searching a source could
 * not be tested without dragging in HTTP wiring.
 *
 * The port says what the slice needs — "give me a resource search for this provider, on behalf of
 * this actor, or tell me why you cannot" — and says nothing about tokens, OAuth, or HTTP.
 */
import type { ConnectorProviderId } from '@docket/connections/provider-catalog-contract';
import type { ResourceSearch } from '@docket/integrations';

/** Why a source could not be searched, in terms the caller can act on. */
export type ConnectorAccessFailure = 'needs_reauth' | 'not_connected' | 'not_searchable';

/** A resolved search handle, or the reason there is not one. */
export type ConnectorAccessResult =
  | { readonly ok: true; readonly search: ResourceSearch }
  | { readonly ok: false; readonly reason: ConnectorAccessFailure };

/** Resolving a connected source into something searchable. */
export interface ConnectorGateway {
  /**
   * Open a resource search against one provider on an actor's behalf.
   *
   * @param actorId - Whose credential funds the call. Never another user's.
   * @param provider - Which source to reach.
   */
  openResourceSearch(
    actorId: string,
    provider: ConnectorProviderId,
  ): Promise<ConnectorAccessResult>;
}

/**
 * The production gateway, over the app's real connector plumbing.
 *
 * @remarks
 * Imported lazily so this module — and everything that depends on the port — stays free of the
 * route layer's own import graph.
 */
export function createConnectorGateway(): ConnectorGateway {
  return {
    async openResourceSearch(actorId, provider): Promise<ConnectorAccessResult> {
      const { connectorFor, resolveConnectorToken } =
        await import('../routes/integration-provider');
      const token = await resolveConnectorToken(actorId, provider);
      if (!token.ok) {
        return {
          ok: false,
          reason: token.reason === 'needs_reauth' ? 'needs_reauth' : 'not_connected',
        };
      }
      const search = connectorFor(provider, token.token).asResourceSearch?.();
      return search === undefined ? { ok: false, reason: 'not_searchable' } : { ok: true, search };
    },
  };
}
