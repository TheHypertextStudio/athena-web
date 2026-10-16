import { z } from 'zod';
import { OrganizationId } from '@docket/identity-access/ids';
import { WorkTypeId, WorkTypeVersionId } from '../ids';

/** Immutable catalog release version, distinct from a persisted workspace publication. */
export const CatalogVersionId = z
  .string()
  .regex(/^[0-9A-HJKMNP-TV-Z]{26}$/)
  .brand<'CatalogVersionId'>();
/** Catalog release version value. */
export type CatalogVersionId = z.infer<typeof CatalogVersionId>;
const tenant = { organizationId: OrganizationId, workTypeId: WorkTypeId };
/** Exact checked origin; draft and catalog facts never claim a database publication. */
export const CopySourceIdentity = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('publication'),
    ...tenant,
    workTypeVersionId: WorkTypeVersionId,
  }),
  z.strictObject({
    kind: z.literal('draft'),
    ...tenant,
    draftRevision: z.number().int().nonnegative(),
    draftFingerprint: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  }),
  z.strictObject({
    kind: z.literal('catalog'),
    release: z.number().int().positive(),
    workTypeId: WorkTypeId,
    catalogVersionId: CatalogVersionId,
  }),
]);
/** Exact checked copy origin value. */
export type CopySourceIdentity = z.infer<typeof CopySourceIdentity>;
/** Stable discriminated source key; tenant/release and draft revision/fingerprint participate. */
export function copyIdentityKey(value: CopySourceIdentity): string {
  const identity = CopySourceIdentity.parse(value);
  if (identity.kind === 'publication')
    return JSON.stringify([
      'publication',
      identity.organizationId,
      identity.workTypeId,
      identity.workTypeVersionId,
    ]);
  if (identity.kind === 'draft')
    return JSON.stringify([
      'draft',
      identity.organizationId,
      identity.workTypeId,
      identity.draftRevision,
      identity.draftFingerprint,
    ]);
  return JSON.stringify([
    'catalog',
    identity.release,
    identity.workTypeId,
    identity.catalogVersionId,
  ]);
}
/** Scope correlation for authored references; catalog releases cannot borrow workspace or other-release facts. */
export function copyIdentityScope(value: CopySourceIdentity): string {
  const identity = CopySourceIdentity.parse(value);
  return identity.kind === 'catalog'
    ? `catalog:${identity.release}`
    : `tenant:${identity.organizationId}`;
}
/** Definition identity independent of its selected revision, preventing cross-version self regeneration. */
export function copyDefinitionKey(value: CopySourceIdentity): string {
  const identity = CopySourceIdentity.parse(value);
  return identity.kind === 'catalog'
    ? `catalog:${identity.workTypeId}`
    : `tenant:${identity.organizationId}:${identity.workTypeId}`;
}
