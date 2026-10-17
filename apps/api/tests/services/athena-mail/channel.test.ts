import { OrganizationId } from '@docket/identity-access/ids';
import { beforeAll, describe, expect, it } from 'vitest';
import { getDb, seedBaseOrg, seedUserWithHub } from '../../support/routes-harness';
import { configureMailChannel, readMailChannel } from '../../../src/services/athena-mail/channel';
let schema: Awaited<ReturnType<typeof getDb>>;
beforeAll(async () => {
  schema = await getDb();
});
describe('owner email enrollment', () => {
  it('does not enable itself on read and rejects unverified account email', async () => {
    const owner = await seedUserWithHub(schema.db, schema, 'MailOwner');
    const { orgId } = await seedBaseOrg(schema.db, schema);
    const before = await readMailChannel(owner);
    expect(before.enabled).toBe(false);
    await expect(
      configureMailChannel(owner, {
        enabled: true,
        ownerRepliesEnabled: true,
        organizationId: OrganizationId.parse(orgId),
      }),
    ).rejects.toThrow();
  });
});
