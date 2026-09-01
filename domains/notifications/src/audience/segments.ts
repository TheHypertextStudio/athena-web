import type { NotificationAudienceSegment } from './types';

const billingAdminRoleKeys = Object.freeze(['owner', 'admin', 'billing_admin'] as const);
const emptyRoleKeys = Object.freeze([] as const);

/** Returns role keys used to resolve role-backed audience segments. */
export function notificationAudienceSegmentRoleKeys(
  segment: NotificationAudienceSegment,
): readonly string[] {
  if (segment === 'billing_admins') return billingAdminRoleKeys;
  return emptyRoleKeys;
}
