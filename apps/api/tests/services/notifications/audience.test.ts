import type * as DbModule from '@docket/db';
import { NotificationAudience } from '@docket/notifications';
import { beforeAll, describe, expect, it } from 'vitest';

import { expandNotificationAudience } from '../../../src/services/notifications/audience';
import { addMember, getDb, seedOrg, seedUserWithHub } from '../../support/routes-harness';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
});

describe('expandNotificationAudience', () => {
  it('expands explicit users once and preserves first-seen order', async () => {
    const firstUserId = await seedUserWithHub(db, schema, 'AudienceExplicitFirst');
    const secondUserId = await seedUserWithHub(db, schema, 'AudienceExplicitSecond');

    const recipients = await expandNotificationAudience(db, {
      type: 'users',
      userIds: [firstUserId, secondUserId, firstUserId],
    });

    expect(recipients).toEqual([
      { userId: firstUserId, organizationId: null, reason: 'explicit' },
      { userId: secondUserId, organizationId: null, reason: 'explicit' },
    ]);
    expect(Object.isFrozen(recipients)).toBe(true);
  });

  it('expands an organization to active human members only', async () => {
    const orgId = await seedOrg(db, schema);
    const activeUserId = await seedUserWithHub(db, schema, 'AudienceOrgActive');
    const suspendedUserId = await seedUserWithHub(db, schema, 'AudienceOrgSuspended');
    const outsideUserId = await seedUserWithHub(db, schema, 'AudienceOrgOutside');
    const outsideOrgId = await seedOrg(db, schema);

    await addMember(db, schema, orgId, activeUserId, 'member', 'active');
    await addMember(db, schema, orgId, suspendedUserId, 'member', 'suspended');
    await addMember(db, schema, outsideOrgId, outsideUserId, 'member', 'active');

    await expect(
      expandNotificationAudience(
        db,
        NotificationAudience.parse({ type: 'organization', organizationId: orgId }),
      ),
    ).resolves.toEqual([{ userId: activeUserId, organizationId: orgId, reason: 'org_member' }]);
  });

  it('expands all users with no organization context', async () => {
    const firstUserId = await seedUserWithHub(db, schema, 'AudienceAllFirst');
    const secondUserId = await seedUserWithHub(db, schema, 'AudienceAllSecond');

    const recipients = await expandNotificationAudience(db, { type: 'all_users' });

    expect(recipients).toContainEqual({
      userId: firstUserId,
      organizationId: null,
      reason: 'segment_match',
    });
    expect(recipients).toContainEqual({
      userId: secondUserId,
      organizationId: null,
      reason: 'segment_match',
    });
  });

  it('expands the billing-admin segment through role-backed active memberships', async () => {
    const orgId = await seedOrg(db, schema);
    const ownerUserId = await seedUserWithHub(db, schema, 'AudienceBillingOwner');
    const memberUserId = await seedUserWithHub(db, schema, 'AudienceBillingMember');
    const suspendedOwnerUserId = await seedUserWithHub(db, schema, 'AudienceBillingSuspended');

    await addMember(db, schema, orgId, ownerUserId, 'owner', 'active');
    await addMember(db, schema, orgId, memberUserId, 'member', 'active');
    await addMember(db, schema, orgId, suspendedOwnerUserId, 'owner', 'suspended');

    const recipients = await expandNotificationAudience(db, {
      type: 'segment',
      segment: 'billing_admins',
    });

    expect(recipients).toContainEqual({
      userId: ownerUserId,
      organizationId: orgId,
      reason: 'segment_match',
    });
    expect(recipients).not.toContainEqual({
      userId: memberUserId,
      organizationId: orgId,
      reason: 'segment_match',
    });
    expect(recipients).not.toContainEqual({
      userId: suspendedOwnerUserId,
      organizationId: orgId,
      reason: 'segment_match',
    });
  });
});
