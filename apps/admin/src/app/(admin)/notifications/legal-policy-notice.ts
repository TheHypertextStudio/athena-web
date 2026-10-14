import type { NotificationAnnouncementDraft } from './notification-console-model';

/** Prepare the policy announcement for the existing staff review and send workflow. */
export function legalPolicyAnnouncementDraft(appUrl: string): NotificationAnnouncementDraft {
  const origin = new URL(appUrl).origin;
  return {
    subject: 'Docket terms and privacy policy update',
    bodyText: [
      'We published updated Docket terms and a privacy policy on October 14, 2026.',
      'The terms apply to existing users on November 13, 2026, after 30 days of notice. Until then, the prior terms continue to apply. New users accept the updated terms when they create an account. Changes apply prospectively and do not remove rights for earlier events.',
      'The update identifies Hypertext Studio and its legal contact, clarifies eligibility and direct-purchase refunds, and explains hosted data, shared work, AI providers, connected services, and deletion controls. The privacy policy is effective October 14, 2026; it does not authorize retroactive use for new purposes.',
      `Read the terms: ${origin}/terms`,
      `Read the privacy policy: ${origin}/privacy`,
      `Read prior versions: ${origin}/legal/history`,
      'For legal notices or privacy requests: legal@hypertext.studio. Hypertext Studio, 1810 East Sahara Avenue, STE 75246, Las Vegas, NV 89104, United States.',
      'You can stop using Docket and manage export or deletion in Settings. Mandatory consumer rights remain protected.',
    ].join('\n\n'),
    webUrl: '/terms',
    audienceType: 'all_users',
    audienceValue: '',
    channels: ['web', 'email'],
    priority: 'normal',
    replyPolicy: 'staff_inbox',
    scheduledAt: '',
  };
}
