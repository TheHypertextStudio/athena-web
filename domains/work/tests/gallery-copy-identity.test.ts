import { describe, expect, it } from 'vitest';
import { CopySourceIdentity, copyIdentityKey } from '../src/gallery/copy-identity';
import { OrganizationId } from '@docket/identity-access/ids';
import { WorkTypeId, WorkTypeVersionId } from '../src/ids';
import { ulid } from './blueprint-fixtures';
const organizationId = OrganizationId.parse(ulid(1));
const workTypeId = WorkTypeId.parse(ulid(2));
const draftFingerprint = `sha256:${'a'.repeat(64)}`;
describe('honest exact copy source identities', () => {
  it('accepts draft revision zero with no version or projection identity', () => {
    const identity = CopySourceIdentity.parse({
      kind: 'draft',
      organizationId,
      workTypeId,
      draftRevision: 0,
      draftFingerprint,
    });
    expect(identity).not.toHaveProperty('workTypeVersionId');
    expect(identity).not.toHaveProperty('stepIds');
    expect(CopySourceIdentity.safeParse({ ...identity, workTypeVersionId: ulid(5) }).success).toBe(
      false,
    );
  });
  it('distinguishes the next draft, actual publication, tenant and catalog release', () => {
    const publication = CopySourceIdentity.parse({
      kind: 'publication',
      organizationId,
      workTypeId,
      workTypeVersionId: WorkTypeVersionId.parse(ulid(3)),
    });
    const draft = CopySourceIdentity.parse({
      kind: 'draft',
      organizationId,
      workTypeId,
      draftRevision: 0,
      draftFingerprint,
    });
    const catalog = CopySourceIdentity.parse({
      kind: 'catalog',
      release: 1,
      workTypeId,
      catalogVersionId: ulid(3),
    });
    expect(
      new Set(
        [
          publication,
          draft,
          catalog,
          { ...publication, organizationId: OrganizationId.parse(ulid(4)) },
          { ...catalog, release: 2 },
        ].map(copyIdentityKey),
      ).size,
    ).toBe(5);
    expect(CopySourceIdentity.safeParse({ ...catalog, organizationId }).success).toBe(false);
  });
  it('rejects imprecise draft fingerprints and negative revisions', () => {
    expect(
      CopySourceIdentity.safeParse({
        kind: 'draft',
        organizationId,
        workTypeId,
        draftRevision: -1,
        draftFingerprint,
      }).success,
    ).toBe(false);
    expect(
      CopySourceIdentity.safeParse({
        kind: 'draft',
        organizationId,
        workTypeId,
        draftRevision: 0,
        draftFingerprint: 'mutable',
      }).success,
    ).toBe(false);
  });
});
