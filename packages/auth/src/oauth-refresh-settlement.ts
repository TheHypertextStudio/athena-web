/** Settle device-bound refresh recovery inside the already-held OAuth client transaction. */
import type { AuthEndpointContext } from '@better-auth/core/context';
import type { DBTransactionAdapter } from '@better-auth/core/db/adapter';

import type { TokenTransactionResult } from './oauth-provider-token-endpoints';
import { clientIdFromRequest, revokeStaleRefresh } from './oauth-provider-live-state';
import { rememberRefreshResponse, replayRefreshResponse } from './oauth-refresh-retry';
import {
  type DocketOAuthResources,
  type OAuthRefreshRecord,
  type TokenBody,
  committedTokenErrorMarker,
} from './oauth-provider-types';

/** Reuse internal issuance for expired recovered access; commit both receipts with its rotation. */
export async function settleRefreshRetry(
  {
    ctx,
    adapter,
    body,
    refresh,
    resources,
  }: {
    readonly ctx: AuthEndpointContext;
    readonly adapter: DBTransactionAdapter;
    readonly body: TokenBody;
    readonly refresh: OAuthRefreshRecord;
    readonly resources: DocketOAuthResources;
  },
  renew: (body: TokenBody) => Promise<TokenTransactionResult>,
): Promise<TokenTransactionResult> {
  if (clientIdFromRequest(ctx, body) !== refresh.clientId) return { kind: 'stale' };
  const recovered = await replayRefreshResponse(ctx, adapter, body, refresh, resources);
  if (!recovered) {
    await revokeStaleRefresh(adapter, refresh);
    return { kind: 'stale' };
  }
  if (recovered.accessExpiresAt > Date.now() + 60_000) {
    return {
      kind: 'issued',
      response: recovered.adjustExpiresIn
        ? {
            ...recovered.response,
            expires_in: Math.floor((recovered.accessExpiresAt - Date.now()) / 1000),
          }
        : recovered.response,
    };
  }
  const result = await renew({ ...body, refresh_token: recovered.response.refresh_token });
  if (!(committedTokenErrorMarker in result) && result.kind === 'issued') {
    await rememberRefreshResponse(ctx, adapter, body, result.response);
  }
  return result;
}
