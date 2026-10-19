/** Separate public MCP refresh traffic from unauthenticated, shared-IP token budgets. */
import { db, oauthClient, oauthRefreshToken, oauthResourceGrant, rateLimit } from '@docket/db';
import { and, eq, gt, isNull, or } from 'drizzle-orm';
import { z } from 'zod';

import { hashOAuthToken } from './oauth-resource-contract';

const requestSchema = z.object({
  grant_type: z.literal('refresh_token'),
  client_id: z.string().min(1).max(2048),
  refresh_token: z.string().min(1).max(4096),
});
const anonymousRule = { window: 60, max: 30 };
const windowMs = 60_000;
const grantMax = 120;

/** Internal limiter signal converted to an OAuth HTTP response by the auth handler boundary. */
export class OAuthRefreshThrottle extends Error {
  /** Seconds until this grant can retry without another authorization. */
  readonly retryAfter: number;

  constructor(retryAfter: number) {
    super('OAuth refresh budget exhausted.');
    this.name = 'OAuthRefreshThrottle';
    this.retryAfter = retryAfter;
  }
}

async function refreshBody(request: Request): Promise<z.infer<typeof requestSchema> | null> {
  try {
    const copy = request.clone();
    const contentType = copy.headers.get('content-type') ?? '';
    let body: unknown;
    if (contentType.startsWith('application/x-www-form-urlencoded')) {
      const fields = new URLSearchParams(await copy.text());
      if ([...fields.keys()].some((key) => fields.getAll(key).length !== 1)) return null;
      body = Object.fromEntries(fields);
    } else if (contentType.startsWith('application/json')) {
      body = await copy.json();
    } else return null;
    const parsed = requestSchema.safeParse(body);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Keep unknown credentials IP-limited; known live public refreshes have a transactional grant budget. */
export async function oauthTokenRateLimit(request: Request): Promise<false | typeof anonymousRule> {
  const body = await refreshBody(request);
  if (!body) return anonymousRule;
  const [credential] = await db
    .select({ grantId: oauthResourceGrant.id, clientId: oauthRefreshToken.clientId })
    .from(oauthRefreshToken)
    .innerJoin(oauthClient, eq(oauthClient.clientId, oauthRefreshToken.clientId))
    .innerJoin(oauthResourceGrant, eq(oauthResourceGrant.id, oauthRefreshToken.docketGrantId))
    .where(
      and(
        eq(oauthRefreshToken.token, await hashOAuthToken(body.refresh_token)),
        eq(oauthRefreshToken.clientId, body.client_id),
        eq(oauthClient.public, true),
        or(eq(oauthClient.disabled, false), isNull(oauthClient.disabled)),
        gt(oauthRefreshToken.expiresAt, new Date()),
        isNull(oauthResourceGrant.revokedAt),
        gt(oauthResourceGrant.expiresAt, new Date()),
      ),
    )
    .limit(1);
  if (!credential) return anonymousRule;
  await consumeRefreshBudget(credential.clientId, credential.grantId);
  return false;
}

/** Charge recognized attempts independently of token issuance, including failed requests. */
async function consumeRefreshBudget(clientId: string, grantId: string): Promise<void> {
  await db.transaction(async (transaction) => {
    // The same client lock used by issuance serializes budget creation across API instances.
    await transaction
      .select({ id: oauthClient.clientId })
      .from(oauthClient)
      .where(eq(oauthClient.clientId, clientId))
      .for('update');
    const key = `docket:oauth-refresh-budget:${grantId}`;
    const [budget] = await transaction
      .select()
      .from(rateLimit)
      .where(eq(rateLimit.key, key))
      .limit(1);
    const now = Date.now();
    const started = budget?.lastRequest ?? 0;
    const active = budget !== undefined && now < started + windowMs;
    if (active && (budget.count ?? 0) >= grantMax) {
      throw new OAuthRefreshThrottle(Math.ceil((started + windowMs - now) / 1000));
    }
    const data = {
      key,
      count: active ? (budget.count ?? 0) + 1 : 1,
      lastRequest: active ? started : now,
    };
    if (budget) {
      await transaction.update(rateLimit).set(data).where(eq(rateLimit.id, budget.id));
    } else {
      await transaction.insert(rateLimit).values(data);
    }
  });
}
