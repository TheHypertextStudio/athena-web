/**
 * `@docket/types` — linked external identity DTOs.
 *
 * @remarks
 * An **identity** is an external account (Google, GitHub, or Linear) the user has linked to their
 * Docket identity via OAuth. It is distinct from the **resources** that identity provides (e.g.
 * Google Task lists) and from the org-scoped **integration** that picks an identity + resources to
 * sync. Identities are user-scoped — the OAuth grant belongs to the Docket user, not an org.
 */
import { z } from 'zod';

/** The social providers a user can link an identity from (mirrors Better Auth `socialProviders`). */
export const IdentityProvider = z
  .enum(['google', 'github', 'linear', 'discord', 'microsoft'])
  .describe(
    'The external social provider an identity is linked from: `google` (OIDC — supplies email/name/picture), `github`, `linear`, `discord` (links a Discord account so mentions of it route to this user), or `microsoft` (Outlook mail via Graph). Mirrors the configured Better Auth `socialProviders` and gates which connectors/observers are available.',
  );
/** Identity-provider value. */
export type IdentityProvider = z.infer<typeof IdentityProvider>;

/**
 * A linked external identity (a Google / GitHub / Linear account the user authorized).
 *
 * @remarks
 * `email`/`name`/`picture` come from the stored OIDC `id_token` (Google) and may be absent — the
 * token can lack a claim, and non-OIDC providers (GitHub/Linear) supply none — so they are
 * nullable; the UI falls back to the provider name. `accountId` is the provider account id (the
 * Google `sub`) — the stable id an org integration binds to as its `externalAccountId`.
 */
export const IdentityOut = z
  .object({
    /** The provider account id (e.g. Google `sub`); an integration's `externalAccountId`. */
    accountId: z
      .string()
      .describe(
        "The provider's stable account id (e.g. the Google OIDC `sub`). This is the id an org integration binds to as its `externalAccountId` — the durable link between this identity and any org sync that uses it.",
      ),
    /** The social provider this identity belongs to. */
    provider: IdentityProvider.describe('Which social provider this linked account belongs to.'),
    /** The account's email, when present in the id token. */
    email: z
      .string()
      .nullable()
      .describe(
        "The linked account's email, decoded server-side from the stored OIDC id token. Null when the token lacks the claim or the provider is non-OIDC (GitHub/Linear); the UI then falls back to the provider name.",
      ),
    /** The account holder's display name, when present. */
    name: z
      .string()
      .nullable()
      .describe("The account holder's display name from the id token, or null when absent."),
    /** Avatar URL, when present. */
    picture: z
      .string()
      .nullable()
      .describe("The account holder's avatar URL from the id token, or null when absent."),
    /** The OAuth scopes granted to this linked account. */
    scopes: z
      .array(z.string())
      .describe(
        'The OAuth scopes the user granted when linking this account — the ceiling on what org integrations using this identity can access.',
      ),
    /** ISO-8601 timestamp the account was linked. */
    linkedAt: z
      .string()
      .describe('ISO-8601 instant the external account was linked to the Docket identity.'),
  })
  .meta({
    id: 'IdentityOut',
    description: 'A linked external identity (a Google / GitHub / Linear / Discord account).',
  });
/** Linked-identity value. */
export type IdentityOut = z.infer<typeof IdentityOut>;

/** The user's linked external identities. */
export const IdentityListOut = z
  .object({
    items: z
      .array(IdentityOut)
      .describe(
        'The external accounts the caller has linked to their Docket identity. Empty when they have linked none.',
      ),
  })
  .meta({ id: 'IdentityListOut', description: "The user's linked external identities." });
/** Identity-list value. */
export type IdentityListOut = z.infer<typeof IdentityListOut>;
