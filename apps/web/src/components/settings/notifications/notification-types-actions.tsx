'use client';

import { useTransition } from 'react';
import { SettingsToggleRow } from '@/components/settings/settings-section';
import { updateNotificationPreferences } from '@/lib/notifications-actions';

interface NotificationTypesActionsProps {
  taskDeadlineReminders: boolean;
  eventReminders: boolean;
  dailyPlanningReminder: boolean;
  weeklyReviewReminder: boolean;
}

export function NotificationTypesActions({
  taskDeadlineReminders,
  eventReminders,
  dailyPlanningReminder,
  weeklyReviewReminder,
}: NotificationTypesActionsProps) {
  const [isPending, startTransition] = useTransition();

  const handleToggle = (key: string, value: boolean) => {
    startTransition(async () => {
      await updateNotificationPreferences({ [key]: value });
    });
  };

  return (
    <div className="divide-outline-variant divide-y">
      <SettingsToggleRow
        label="Task Deadline Reminders"
        description="Get reminded before task deadlines"
        checked={taskDeadlineReminders}
        onCheckedChange={(checked) => {
          handleToggle('taskDeadlineReminders', checked);
        }}
        disabled={isPending}
      />

      <SettingsToggleRow
        label="Event Reminders"
        description="Get reminded before calendar events"
        checked={eventReminders}
        onCheckedChange={(checked) => {
          handleToggle('eventReminders', checked);
        }}
        disabled={isPending}
      />

      <SettingsToggleRow
        label="Daily Planning Reminder"
        description="Reminder to plan your day"
        checked={dailyPlanningReminder}
        onCheckedChange={(checked) => {
          handleToggle('dailyPlanningReminder', checked);
        }}
        disabled={isPending}
      />

      <SettingsToggleRow
        label="Weekly Review Reminder"
        description="Reminder to review your week"
        checked={weeklyReviewReminder}
        onCheckedChange={(checked) => {
          handleToggle('weeklyReviewReminder', checked);
        }}
        disabled={isPending}
      />
    </div>
  );
}
