/**
 * `@docket/authz` — explicit-grant containment compatibility exports.
 *
 * @remarks
 * Explicit-grant containment is persistence-owned by the deliberate
 * `@docket/db/identity-access` public adapter. Authz re-exports that surface so existing callers
 * retain their imports without coupling to a database root barrel or duplicating containment
 * traversal.
 */

/** Compatibility re-export of the DB-owned containment loader. */
export { ancestorChain } from '@docket/db/identity-access';

/** Compatibility re-exports of the DB-owned containment resource types. */
export type { ResourceKind, ResourceRef } from '@docket/db/identity-access';
