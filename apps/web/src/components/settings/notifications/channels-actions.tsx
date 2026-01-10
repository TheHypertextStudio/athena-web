'use client';

import { useTransition } from 'react';
import EmailOutlinedIcon from '@mui/icons-material/EmailOutlined';
import NotificationsOutlinedIcon from '@mui/icons-material/NotificationsOutlined';
import SmsOutlinedIcon from '@mui/icons-material/SmsOutlined';
import TagOutlinedIcon from '@mui/icons-material/TagOutlined';
import InboxOutlinedIcon from '@mui/icons-material/InboxOutlined';
import { SettingsToggleRow } from '@/components/settings/settings-section';
import { updateNotificationPreferences } from '@/lib/notifications-actions';

interface ChannelsActionsProps {
  emailEnabled: boolean;
  pushEnabled: boolean;
  smsEnabled: boolean;
  slackEnabled: boolean;
  inAppEnabled: boolean;
}

export function ChannelsActions({
  emailEnabled,
  pushEnabled,
  smsEnabled,
  slackEnabled,
  inAppEnabled,
}: ChannelsActionsProps) {
  const [isPending, startTransition] = useTransition();

  const handleToggle = (key: string, value: boolean) => {
    startTransition(async () => {
      await updateNotificationPreferences({ [key]: value });
    });
  };

  return (
    <div className="divide-outline-variant divide-y">
      <SettingsToggleRow
        icon={<EmailOutlinedIcon sx={{ fontSize: 18 }} />}
        label="Email"
        description="Receive notifications via email"
        checked={emailEnabled}
        onCheckedChange={(checked) => {
          handleToggle('emailEnabled', checked);
        }}
        disabled={isPending}
      />

      <SettingsToggleRow
        icon={<NotificationsOutlinedIcon sx={{ fontSize: 18 }} />}
        label="Push Notifications"
        description="Browser and mobile push notifications"
        checked={pushEnabled}
        onCheckedChange={(checked) => {
          handleToggle('pushEnabled', checked);
        }}
        disabled={isPending}
      />

      <SettingsToggleRow
        icon={<SmsOutlinedIcon sx={{ fontSize: 18 }} />}
        label="SMS"
        description="Text message notifications for urgent items"
        checked={smsEnabled}
        onCheckedChange={(checked) => {
          handleToggle('smsEnabled', checked);
        }}
        disabled={isPending}
      />

      <SettingsToggleRow
        icon={<TagOutlinedIcon sx={{ fontSize: 18 }} />}
        label="Slack"
        description="Receive notifications in Slack"
        checked={slackEnabled}
        onCheckedChange={(checked) => {
          handleToggle('slackEnabled', checked);
        }}
        disabled={isPending}
      />

      <SettingsToggleRow
        icon={<InboxOutlinedIcon sx={{ fontSize: 18 }} />}
        label="In-App"
        description="Show notifications inside Athena"
        checked={inAppEnabled}
        onCheckedChange={(checked) => {
          handleToggle('inAppEnabled', checked);
        }}
        disabled={isPending}
      />
    </div>
  );
}
