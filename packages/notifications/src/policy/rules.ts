import type { NotificationCategory, NotificationChannel, NotificationSenderType } from '../schemas';
import type {
  NotificationApprovalRequirement,
  NotificationPolicyDecision,
  NotificationPolicyDenyReason,
  NotificationPolicyInput,
} from './types';

const systemOrStaffSenders = new Set<NotificationSenderType>(['system', 'staff']);

/** Returns true when a category can use a channel before user-specific preferences apply. */
export function categoryAllowsChannel(
  category: NotificationCategory,
  _channel: NotificationChannel,
): boolean {
  return category !== 'marketing';
}

/** Returns true when users cannot disable the category for safety or account integrity. */
export function lockedPreference(category: NotificationCategory): boolean {
  return category === 'security' || category === 'account';
}

/** Returns approval gates for notification intents that are allowed but risky. */
export function requiresApproval(input: NotificationPolicyInput): NotificationApprovalRequirement {
  const reasons: NotificationApprovalRequirement['reasons'][number][] = [];

  if (input.channels.includes('sms') && targetsMultipleRecipients(input)) {
    reasons.push('sms_multi_recipient');
  }

  return {
    required: reasons.length > 0,
    reasons,
    approver: reasons.length > 0 ? 'staff' : null,
  };
}

/** Evaluates whether a caller may create a notification intent. */
export function canCreateNotification(input: NotificationPolicyInput): NotificationPolicyDecision {
  const denialReasons: NotificationPolicyDenyReason[] = [];

  if (input.audience.type === 'all_users' && input.senderType !== 'staff') {
    denialReasons.push('all_users_requires_staff_sender');
  }

  if (
    (input.category === 'security' || input.category === 'account') &&
    !systemOrStaffSenders.has(input.senderType)
  ) {
    denialReasons.push('category_requires_system_or_staff_sender');
  }

  for (const channel of input.channels) {
    if (!categoryAllowsChannel(input.category, channel)) {
      denialReasons.push(
        input.category === 'marketing'
          ? 'marketing_requires_dedicated_consent_surface'
          : 'category_channel_disallowed',
      );
      break;
    }
  }

  return {
    allowed: denialReasons.length === 0,
    denialReasons,
    approval: requiresApproval(input),
  };
}

function targetsMultipleRecipients(input: NotificationPolicyInput): boolean {
  switch (input.audience.type) {
    case 'user':
      return false;
    case 'users':
      return input.audience.userIds.length > 1;
    case 'organization':
    case 'all_users':
    case 'segment':
      return true;
  }
}
