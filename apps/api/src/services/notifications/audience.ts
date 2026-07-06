import type { Database } from '@docket/db';
import { actor, contactPoint, organization, role, user as userTable } from '@docket/db';
import {
  dedupeNotificationRecipients,
  notificationAudienceSegmentRoleKeys,
  type NotificationAudience,
  type NotificationAudienceSegment,
  type NotificationRecipientInput,
} from '@docket/notifications';
import { and, eq, inArray, isNotNull } from 'drizzle-orm';

/** Expands a notification audience selector into immutable recipient snapshot inputs. */
export async function expandNotificationAudience(
  db: Database,
  audience: NotificationAudience,
): Promise<readonly NotificationRecipientInput[]> {
  switch (audience.type) {
    case 'user':
      return dedupeNotificationRecipients([
        { userId: audience.userId, organizationId: null, reason: 'explicit' },
      ]);
    case 'users':
      return dedupeNotificationRecipients(
        audience.userIds.map((userId) => ({ userId, organizationId: null, reason: 'explicit' })),
      );
    case 'organization':
      return expandOrganizationAudience(db, audience.organizationId);
    case 'all_users':
      return expandAllUsersAudience(db);
    case 'segment':
      return expandSegmentAudience(db, audience.segment);
  }
}

async function expandOrganizationAudience(
  db: Database,
  organizationId: string,
): Promise<readonly NotificationRecipientInput[]> {
  const rows = await db
    .select({
      userId: actor.userId,
      organizationId: actor.organizationId,
    })
    .from(actor)
    .where(
      and(
        eq(actor.organizationId, organizationId),
        eq(actor.kind, 'human'),
        eq(actor.status, 'active'),
        isNotNull(actor.userId),
      ),
    );

  return dedupeNotificationRecipients(
    rows.flatMap((row) =>
      row.userId
        ? [{ userId: row.userId, organizationId: row.organizationId, reason: 'org_member' }]
        : [],
    ),
  );
}

async function expandAllUsersAudience(
  db: Database,
): Promise<readonly NotificationRecipientInput[]> {
  const rows = await db.select({ userId: userTable.id }).from(userTable);

  return dedupeNotificationRecipients(
    rows.map((row) => ({ userId: row.userId, organizationId: null, reason: 'segment_match' })),
  );
}

async function expandSegmentAudience(
  db: Database,
  segment: NotificationAudienceSegment,
): Promise<readonly NotificationRecipientInput[]> {
  switch (segment) {
    case 'active_users':
      return expandActiveUsersSegment(db);
    case 'trial_users':
      return expandTrialUsersSegment(db);
    case 'billing_admins':
      return expandRoleBackedSegment(db, notificationAudienceSegmentRoleKeys(segment));
    case 'users_with_bounced_email':
      return expandBouncedEmailSegment(db);
    case 'users_without_verified_phone':
      return expandUsersWithoutVerifiedPhoneSegment(db);
  }
}

async function expandActiveUsersSegment(
  db: Database,
): Promise<readonly NotificationRecipientInput[]> {
  const rows = await db
    .select({
      userId: actor.userId,
      organizationId: actor.organizationId,
    })
    .from(actor)
    .where(and(eq(actor.kind, 'human'), eq(actor.status, 'active'), isNotNull(actor.userId)));

  return dedupeNotificationRecipients(toSegmentRecipients(rows));
}

async function expandTrialUsersSegment(
  db: Database,
): Promise<readonly NotificationRecipientInput[]> {
  const rows = await db
    .select({
      userId: actor.userId,
      organizationId: actor.organizationId,
    })
    .from(actor)
    .innerJoin(organization, eq(actor.organizationId, organization.id))
    .where(
      and(
        eq(actor.kind, 'human'),
        eq(actor.status, 'active'),
        isNotNull(actor.userId),
        eq(organization.lifecycleState, 'trialing'),
      ),
    );

  return dedupeNotificationRecipients(toSegmentRecipients(rows));
}

async function expandRoleBackedSegment(
  db: Database,
  roleKeys: readonly string[],
): Promise<readonly NotificationRecipientInput[]> {
  if (roleKeys.length === 0) return dedupeNotificationRecipients([]);

  const rows = await db
    .select({
      userId: actor.userId,
      organizationId: actor.organizationId,
    })
    .from(actor)
    .innerJoin(role, eq(actor.roleId, role.id))
    .where(
      and(
        eq(actor.kind, 'human'),
        eq(actor.status, 'active'),
        isNotNull(actor.userId),
        inArray(role.key, [...roleKeys]),
      ),
    );

  return dedupeNotificationRecipients(toSegmentRecipients(rows));
}

async function expandBouncedEmailSegment(
  db: Database,
): Promise<readonly NotificationRecipientInput[]> {
  const rows = await db
    .select({ userId: contactPoint.userId })
    .from(contactPoint)
    .where(and(eq(contactPoint.type, 'email'), eq(contactPoint.status, 'bounced')));

  return dedupeNotificationRecipients(
    rows.map((row) => ({ userId: row.userId, organizationId: null, reason: 'segment_match' })),
  );
}

async function expandUsersWithoutVerifiedPhoneSegment(
  db: Database,
): Promise<readonly NotificationRecipientInput[]> {
  const allUsers = await db.select({ userId: userTable.id }).from(userTable);
  const phoneUsers = await db
    .select({ userId: contactPoint.userId })
    .from(contactPoint)
    .where(and(eq(contactPoint.type, 'phone'), eq(contactPoint.status, 'active')));
  const verifiedPhoneUserIds = new Set(phoneUsers.map((row) => row.userId));

  return dedupeNotificationRecipients(
    allUsers.flatMap((row) =>
      verifiedPhoneUserIds.has(row.userId)
        ? []
        : [{ userId: row.userId, organizationId: null, reason: 'segment_match' }],
    ),
  );
}

function toSegmentRecipients(
  rows: readonly { readonly userId: string | null; readonly organizationId: string | null }[],
): NotificationRecipientInput[] {
  return rows.flatMap((row) =>
    row.userId
      ? [{ userId: row.userId, organizationId: row.organizationId, reason: 'segment_match' }]
      : [],
  );
}
