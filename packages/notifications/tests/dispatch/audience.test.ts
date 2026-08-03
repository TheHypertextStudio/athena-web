import type * as DbModule from '@docket/db';
import { NotificationAudience } from '@docket/notifications';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import { expandNotificationAudience } from '../../src/dispatch/audience';
import { getMigratedDb } from '../support/db';
import { addMember, seedContactPoint, seedOrg, seedUser } from '../support/seed';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;

beforeAll(async () => {
  schema = await getMigratedDb();
  db = schema.db;
});

describe('expandNotificationAudience', () => {
  it('expands a single explicit user', async () => {
    const userId = await seedUser(db, schema, 'AudienceSingleUser');

    const recipients = await expandNotificationAudience(db, { type: 'user', userId });

    expect(recipients).toEqual([{ userId, organizationId: null, reason: 'explicit' }]);
    expect(Object.isFrozen(recipients)).toBe(true);
  });

  it('expands explicit users once and preserves first-seen order', async () => {
    const firstUserId = await seedUser(db, schema, 'AudienceExplicitFirst');
    const secondUserId = await seedUser(db, schema, 'AudienceExplicitSecond');

    const recipients = await expandNotificationAudience(db, {
      type: 'users',
      userIds: [firstUserId, secondUserId, firstUserId],
    });

    expect(recipients).toEqual([
      { userId: firstUserId, organizationId: null, reason: 'explicit' },
      { userId: secondUserId, organizationId: null, reason: 'explicit' },
    ]);
  });

  it('expands an organization to active human members only', async () => {
    const orgId = await seedOrg(db, schema);
    const activeUserId = await seedUser(db, schema, 'AudienceOrgActive');
    const suspendedUserId = await seedUser(db, schema, 'AudienceOrgSuspended');
    const outsideUserId = await seedUser(db, schema, 'AudienceOrgOutside');
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
    const firstUserId = await seedUser(db, schema, 'AudienceAllFirst');
    const secondUserId = await seedUser(db, schema, 'AudienceAllSecond');

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

  describe('segment: active_users', () => {
    it('includes only active human members, across organizations', async () => {
      const orgId = await seedOrg(db, schema);
      const activeUserId = await seedUser(db, schema, 'AudienceActiveSegmentActive');
      const suspendedUserId = await seedUser(db, schema, 'AudienceActiveSegmentSuspended');
      await addMember(db, schema, orgId, activeUserId, 'member', 'active');
      await addMember(db, schema, orgId, suspendedUserId, 'member', 'suspended');

      const recipients = await expandNotificationAudience(db, {
        type: 'segment',
        segment: 'active_users',
      });

      expect(recipients).toContainEqual({
        userId: activeUserId,
        organizationId: orgId,
        reason: 'segment_match',
      });
      expect(recipients).not.toContainEqual(expect.objectContaining({ userId: suspendedUserId }));
    });
  });

  describe('segment: trial_users', () => {
    it('includes only active members of trialing organizations', async () => {
      const trialingOrgId = await seedOrg(db, schema);
      const activeOrgId = await seedOrg(db, schema);
      await db
        .update(schema.organization)
        .set({ lifecycleState: 'active' })
        .where(eq(schema.organization.id, activeOrgId));

      const trialUserId = await seedUser(db, schema, 'AudienceTrialUser');
      const activeOrgUserId = await seedUser(db, schema, 'AudienceActiveOrgUser');
      await addMember(db, schema, trialingOrgId, trialUserId, 'member', 'active');
      await addMember(db, schema, activeOrgId, activeOrgUserId, 'member', 'active');

      const recipients = await expandNotificationAudience(db, {
        type: 'segment',
        segment: 'trial_users',
      });

      expect(recipients).toContainEqual({
        userId: trialUserId,
        organizationId: trialingOrgId,
        reason: 'segment_match',
      });
      expect(recipients).not.toContainEqual(expect.objectContaining({ userId: activeOrgUserId }));
    });
  });

  describe('segment: billing_admins', () => {
    it('expands through role-backed active owner/admin/billing_admin memberships', async () => {
      const orgId = await seedOrg(db, schema);
      const ownerUserId = await seedUser(db, schema, 'AudienceBillingOwner');
      const memberUserId = await seedUser(db, schema, 'AudienceBillingMember');
      const suspendedOwnerUserId = await seedUser(db, schema, 'AudienceBillingSuspended');

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
      expect(recipients).not.toContainEqual(expect.objectContaining({ userId: memberUserId }));
      expect(recipients).not.toContainEqual(
        expect.objectContaining({ userId: suspendedOwnerUserId }),
      );
    });
  });

  describe('segment: users_with_bounced_email', () => {
    it('includes only users with a bounced email contact point', async () => {
      const bouncedUserId = await seedUser(db, schema, 'AudienceBouncedEmail');
      const activeEmailUserId = await seedUser(db, schema, 'AudienceActiveEmail');
      await seedContactPoint(db, schema, bouncedUserId, {
        type: 'email',
        value: 'bounced@example.test',
        valueNormalized: 'bounced@example.test',
        status: 'bounced',
      });
      await seedContactPoint(db, schema, activeEmailUserId, {
        type: 'email',
        value: 'active@example.test',
        valueNormalized: 'active@example.test',
        status: 'active',
      });

      const recipients = await expandNotificationAudience(db, {
        type: 'segment',
        segment: 'users_with_bounced_email',
      });

      expect(recipients).toContainEqual({
        userId: bouncedUserId,
        organizationId: null,
        reason: 'segment_match',
      });
      expect(recipients).not.toContainEqual(expect.objectContaining({ userId: activeEmailUserId }));
    });
  });

  describe('segment: users_without_verified_phone', () => {
    it('includes users with no active phone contact point', async () => {
      const noPhoneUserId = await seedUser(db, schema, 'AudienceNoPhone');
      const verifiedPhoneUserId = await seedUser(db, schema, 'AudienceVerifiedPhone');
      await seedContactPoint(db, schema, verifiedPhoneUserId, {
        type: 'phone',
        value: '+17025550100',
        valueNormalized: '+17025550100',
        status: 'active',
      });

      const recipients = await expandNotificationAudience(db, {
        type: 'segment',
        segment: 'users_without_verified_phone',
      });

      expect(recipients).toContainEqual({
        userId: noPhoneUserId,
        organizationId: null,
        reason: 'segment_match',
      });
      expect(recipients).not.toContainEqual(
        expect.objectContaining({ userId: verifiedPhoneUserId }),
      );
    });
  });
});
