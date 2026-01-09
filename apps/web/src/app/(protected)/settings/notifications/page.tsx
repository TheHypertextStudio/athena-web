'use client';

import EmailOutlinedIcon from '@mui/icons-material/EmailOutlined';
import NotificationsOutlinedIcon from '@mui/icons-material/NotificationsOutlined';
import SmsOutlinedIcon from '@mui/icons-material/SmsOutlined';
import TagOutlinedIcon from '@mui/icons-material/TagOutlined';
import InboxOutlinedIcon from '@mui/icons-material/InboxOutlined';
import { useNotificationPreferences } from '@/hooks/use-notifications';
import {
  SettingsSection,
  SettingsRow,
  SettingsToggleRow,
} from '@/components/settings/settings-section';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const COMMON_TIMEZONES = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'Europe/London',
  'Europe/Paris',
  'Asia/Tokyo',
  'UTC',
];

export default function NotificationsSettingsPage() {
  const { preferences, isLoading, update, isUpdating } = useNotificationPreferences();

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-[250px] w-full" />
        <Skeleton className="h-[200px] w-full" />
        <Skeleton className="h-[250px] w-full" />
      </div>
    );
  }

  if (!preferences) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-[250px] w-full" />
        <Skeleton className="h-[200px] w-full" />
        <Skeleton className="h-[250px] w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Notification Channels */}
      <SettingsSection title="Channels" description="Choose how you want to receive notifications.">
        <div className="divide-outline-variant divide-y">
          <SettingsToggleRow
            icon={<EmailOutlinedIcon sx={{ fontSize: 18 }} />}
            label="Email"
            description="Receive notifications via email"
            checked={preferences.emailEnabled}
            onCheckedChange={(checked) => {
              update({ emailEnabled: checked });
            }}
            disabled={isUpdating}
          />

          <SettingsToggleRow
            icon={<NotificationsOutlinedIcon sx={{ fontSize: 18 }} />}
            label="Push Notifications"
            description="Browser and mobile push notifications"
            checked={preferences.pushEnabled}
            onCheckedChange={(checked) => {
              update({ pushEnabled: checked });
            }}
            disabled={isUpdating}
          />

          <SettingsToggleRow
            icon={<SmsOutlinedIcon sx={{ fontSize: 18 }} />}
            label="SMS"
            description="Text message notifications for urgent items"
            checked={preferences.smsEnabled}
            onCheckedChange={(checked) => {
              update({ smsEnabled: checked });
            }}
            disabled={isUpdating}
          />

          <SettingsToggleRow
            icon={<TagOutlinedIcon sx={{ fontSize: 18 }} />}
            label="Slack"
            description="Receive notifications in Slack"
            checked={preferences.slackEnabled}
            onCheckedChange={(checked) => {
              update({ slackEnabled: checked });
            }}
            disabled={isUpdating}
          />

          <SettingsToggleRow
            icon={<InboxOutlinedIcon sx={{ fontSize: 18 }} />}
            label="In-App"
            description="Show notifications inside Athena"
            checked={preferences.inAppEnabled}
            onCheckedChange={(checked) => {
              update({ inAppEnabled: checked });
            }}
            disabled={isUpdating}
          />
        </div>
      </SettingsSection>

      {/* Quiet Hours */}
      <SettingsSection title="Quiet Hours" description="Pause notifications during specific times.">
        <div className="divide-outline-variant divide-y">
          <SettingsToggleRow
            label="Enable Quiet Hours"
            description="Silence notifications during set times"
            checked={preferences.quietHoursEnabled}
            onCheckedChange={(checked) => {
              update({ quietHoursEnabled: checked });
            }}
            disabled={isUpdating}
          />

          {preferences.quietHoursEnabled && (
            <>
              <SettingsRow label="Start Time" description="When quiet hours begin">
                <Input
                  type="time"
                  value={preferences.quietHoursStart ?? '22:00'}
                  onChange={(e) => {
                    update({ quietHoursStart: e.target.value });
                  }}
                  disabled={isUpdating}
                  className="w-[140px]"
                />
              </SettingsRow>

              <SettingsRow label="End Time" description="When quiet hours end">
                <Input
                  type="time"
                  value={preferences.quietHoursEnd ?? '08:00'}
                  onChange={(e) => {
                    update({ quietHoursEnd: e.target.value });
                  }}
                  disabled={isUpdating}
                  className="w-[140px]"
                />
              </SettingsRow>

              <SettingsRow label="Timezone" description="Timezone for quiet hours">
                <Select
                  value={preferences.quietHoursTimezone ?? 'UTC'}
                  onValueChange={(value) => {
                    update({ quietHoursTimezone: value });
                  }}
                  disabled={isUpdating}
                >
                  <SelectTrigger className="w-[180px]">
                    <SelectValue placeholder="Select timezone" />
                  </SelectTrigger>
                  <SelectContent>
                    {COMMON_TIMEZONES.map((tz) => (
                      <SelectItem key={tz} value={tz}>
                        {tz.replace(/_/g, ' ')}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </SettingsRow>
            </>
          )}
        </div>
      </SettingsSection>

      {/* Notification Types */}
      <SettingsSection
        title="Notification Types"
        description="Choose which notifications to receive."
      >
        <div className="divide-outline-variant divide-y">
          <SettingsToggleRow
            label="Task Deadline Reminders"
            description="Get reminded before task deadlines"
            checked={preferences.taskDeadlineReminders}
            onCheckedChange={(checked) => {
              update({ taskDeadlineReminders: checked });
            }}
            disabled={isUpdating}
          />

          <SettingsToggleRow
            label="Event Reminders"
            description="Get reminded before calendar events"
            checked={preferences.eventReminders}
            onCheckedChange={(checked) => {
              update({ eventReminders: checked });
            }}
            disabled={isUpdating}
          />

          <SettingsToggleRow
            label="Daily Planning Reminder"
            description="Reminder to plan your day"
            checked={preferences.dailyPlanningReminder}
            onCheckedChange={(checked) => {
              update({ dailyPlanningReminder: checked });
            }}
            disabled={isUpdating}
          />

          <SettingsToggleRow
            label="Weekly Review Reminder"
            description="Reminder to review your week"
            checked={preferences.weeklyReviewReminder}
            onCheckedChange={(checked) => {
              update({ weeklyReviewReminder: checked });
            }}
            disabled={isUpdating}
          />
        </div>
      </SettingsSection>
    </div>
  );
}
