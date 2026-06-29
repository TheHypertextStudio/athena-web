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
export const IdentityProvider = z.enum(['google', 'github', 'linear']);
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
    accountId: z.string(),
    /** The social provider this identity belongs to. */
    provider: IdentityProvider,
    /** The account's email, when present in the id token. */
    email: z.string().nullable(),
    /** The account holder's display name, when present. */
    name: z.string().nullable(),
    /** Avatar URL, when present. */
    picture: z.string().nullable(),
    /** The OAuth scopes granted to this linked account. */
    scopes: z.array(z.string()),
    /** ISO-8601 timestamp the account was linked. */
    linkedAt: z.string(),
  })
  .meta({
    id: 'IdentityOut',
    description: 'A linked external identity (a Google / GitHub / Linear account).',
  });
/** Linked-identity value. */
export type IdentityOut = z.infer<typeof IdentityOut>;

/** The user's linked external identities. */
export const IdentityListOut = z
  .object({ items: z.array(IdentityOut) })
  .meta({ id: 'IdentityListOut', description: "The user's linked external identities." });
/** Identity-list value. */
export type IdentityListOut = z.infer<typeof IdentityListOut>;
