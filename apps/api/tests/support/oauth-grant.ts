/**
 * Test support — seeding the OAuth grant records a Bearer call is checked against.
 *
 * @remarks
 * `resolveBearerContext` in `apps/api/src/mcp/auth.ts` does not trust a valid signature alone: it
 * reads the token's `azp` claim and re-checks that the caller's grant for that client is still
 * standing, so that revoking a connected app stops it at the very next request (MISS-05). That
 * makes "a registered client the user has consented to" a precondition of every Bearer test, not
 * an incidental detail — and a precondition that is easy to get subtly wrong, since the
 * `oauth_consent.user_id` foreign key means a grant can only be seeded for a real `user` row.
 *
 * These helpers exist so each suite states that precondition in one line and so the two shapes a
 * live grant can take stay in one place:
 *
 * - {@link seedConsentedClient} — the ordinary third-party client, authorized through the consent
 *   screen. This is what a revocation test later deletes.
 * - {@link seedSkipConsentClient} — a client registered with `skip_consent`, which never writes a
 *   consent row because it never shows the screen. Its registration *is* the authorization.
 *
 * Both take the already-loaded `@docket/db` module rather than importing it. The MCP suites stub
 * `MCP_ISSUER_URL`/`MCP_RESOURCE_URL` in `beforeAll` and only then import the modules that snapshot
 * `process.env`; a static value import here would run before that and quietly unconfigure the
 * resource server, turning every Bearer request into a 401 that looks exactly like a bad token.
 */
import type * as DbModule from '@docket/db';

/** A seeded OAuth client and the token claim that names it. */
export interface SeededClient {
  /** The registered `oauth_client.client_id` — the value a token carries as `azp`. */
  readonly clientId: string;
}

/** A short unique client id, so parallel suites never collide on the unique index. */
function newClientId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Register a client and record `userId`'s consent to `scopes` — a live, revocable grant.
 *
 * @param schema - The loaded `@docket/db` module (from `getMigratedDb()`).
 * @param userId - The consenting user; must be a real `user` row (the consent FK cascades from it).
 * @param scopes - The scope tokens the consent screen recorded.
 * @returns The seeded client id, to be used as the token's `azp` claim.
 */
export async function seedConsentedClient(
  schema: typeof DbModule,
  userId: string,
  scopes: readonly string[],
): Promise<SeededClient> {
  const clientId = newClientId('grant');
  await schema.db.insert(schema.oauthClient).values({
    clientId,
    name: 'Docket Test Client',
    redirectUris: ['https://client.example/callback'],
  });
  await schema.db
    .insert(schema.oauthConsent)
    .values({ clientId, userId, scopes: [...scopes], createdAt: new Date() });
  return { clientId };
}

/**
 * Register a `skip_consent` client — authorized by its registration, with no consent row.
 *
 * @remarks
 * The branch that keeps first-party clients working: they never reach the consent screen, so
 * requiring a consent row of them would lock them out entirely.
 *
 * @param schema - The loaded `@docket/db` module (from `getMigratedDb()`).
 * @returns The seeded client id, to be used as the token's `azp` claim.
 */
export async function seedSkipConsentClient(schema: typeof DbModule): Promise<SeededClient> {
  const clientId = newClientId('firstparty');
  await schema.db.insert(schema.oauthClient).values({
    clientId,
    name: 'Docket First Party',
    redirectUris: ['https://docket.test/callback'],
    skipConsent: true,
  });
  return { clientId };
}
