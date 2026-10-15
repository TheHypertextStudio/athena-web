/** Private definition authority is distinct from a Program manager's schedule authority. */
import type { Database } from '@docket/db';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CapabilityError, NotFoundError } from '../../src/error';
import { requireLegacyDefinitionAccess } from '../../src/lib/recurrence/legacy-definition-access';

const grants = vi.hoisted(() => ({ canActor: vi.fn(), live: vi.fn(), metadataRead: vi.fn() }));
vi.mock('@docket/authz', () => ({ canActor: grants.canActor }));
vi.mock('../../src/lib/work-creation/context', () => ({ loadCreationActor: grants.live }));
const input = { organizationId: 'org', actorId: 'owner', definitionId: 'definition' };
function database(head: unknown[], old: unknown[] = [], rowSecurityActive = false): Database {
  const limit = vi.fn().mockResolvedValueOnce(head).mockResolvedValueOnce(old);
  const query = { from: vi.fn().mockReturnThis(), where: vi.fn().mockReturnThis(), limit };
  // The fixture implements only the metadata query surface used by this access check.
  return {
    select: (..._args: unknown[]) => {
      grants.metadataRead();
      return query;
    },
    execute: vi.fn().mockResolvedValue({ rows: [{ active: rowSecurityActive }] }),
  } as unknown as Database;
}
beforeEach(() => {
  vi.resetAllMocks();
  grants.live.mockResolvedValue({ orgId: 'org', actorId: 'owner' });
  grants.canActor.mockImplementation(async (_actor, capability) => ({
    allow: capability !== 'manage',
  }));
});
describe('legacy private definition access', () => {
  it('allows a currently visible owner to reopen and edit their private definition', async () => {
    const db = database([{ id: 'definition', ownerActorId: 'owner' }]);
    await expect(requireLegacyDefinitionAccess(db, input, 'manage')).resolves.toMatchObject({
      canEdit: true,
    });
  });
  it('allows an actual workspace manager but never substitutes a Program manager', async () => {
    const db = database([{ id: 'definition', ownerActorId: 'another' }]);
    await expect(requireLegacyDefinitionAccess(db, input)).rejects.toBeInstanceOf(NotFoundError);
    grants.canActor.mockResolvedValue({ allow: true });
    await expect(
      requireLegacyDefinitionAccess(
        database([{ id: 'definition', ownerActorId: 'another' }]),
        input,
      ),
    ).resolves.toMatchObject({ canEdit: true });
    expect(grants.canActor).toHaveBeenCalledWith(
      'owner',
      'manage',
      { kind: 'organization', id: 'org', orgId: 'org' },
      expect.anything(),
    );
  });
  it('does not let creator attribution bypass revoked current visibility', async () => {
    grants.canActor.mockResolvedValue({ allow: false });
    await expect(
      requireLegacyDefinitionAccess(database([{ id: 'definition', ownerActorId: 'owner' }]), input),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
  it('refuses editing when the owner retains only View', async () => {
    grants.canActor.mockImplementation(async (_actor, capability) => ({
      allow: capability === 'view',
    }));
    await expect(
      requireLegacyDefinitionAccess(
        database([{ id: 'definition', ownerActorId: 'owner' }]),
        input,
        'manage',
      ),
    ).rejects.toBeInstanceOf(CapabilityError);
  });
  it('uses old creator metadata only when no converted head exists', async () => {
    await expect(
      requireLegacyDefinitionAccess(
        database([], [{ id: 'definition', createdBy: 'owner' }]),
        input,
      ),
    ).resolves.toMatchObject({ canEdit: true });
    await expect(
      requireLegacyDefinitionAccess(
        database(
          [{ id: 'definition', ownerActorId: null }],
          [{ id: 'definition', createdBy: 'owner' }],
        ),
        input,
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
  it('requires the actual active actor before querying definition metadata', async () => {
    grants.live.mockRejectedValue(new NotFoundError());
    const db = database([{ id: 'definition', ownerActorId: 'owner' }]);
    await expect(requireLegacyDefinitionAccess(db, input)).rejects.toBeInstanceOf(NotFoundError);
    expect(grants.metadataRead).not.toHaveBeenCalled();
  });
  it('fails closed when RLS can hide a converted head instead of restoring old creator access', async () => {
    await expect(
      requireLegacyDefinitionAccess(
        database([], [{ id: 'definition', createdBy: 'owner' }], true),
        input,
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
