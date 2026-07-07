import '@testing-library/jest-dom/vitest';

import { makeNotificationPreferenceOutFixture } from '@docket/notifications/testing';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { NotificationPreferencesSection } from '../../../src/components/settings/notification-preferences-section';

afterEach(cleanup);

describe('NotificationPreferencesSection', () => {
  it('keeps security preferences locked while mutable categories can be changed', async () => {
    const onPatch = vi.fn(() => Promise.resolve());
    render(
      <NotificationPreferencesSection
        preferences={makeNotificationPreferenceOutFixture({
          categories: {
            security: { web: true, email: true, sms: true, push: true, locked: true },
            account: { web: true, email: true, sms: false, push: false, locked: true },
            service_announcement: { web: true, email: true, sms: false, push: false },
            workflow: { web: true, email: false, sms: false, push: false },
          },
        })}
        saving={false}
        error={null}
        onPatch={onPatch}
      />,
    );

    expect(screen.getByLabelText('Email for Security')).toBeDisabled();
    expect(screen.getAllByText('Required')).toHaveLength(2);

    fireEvent.click(screen.getByLabelText('Email for Service announcements'));

    await waitFor(() => {
      expect(onPatch).toHaveBeenCalledWith({
        categories: { service_announcement: { email: false } },
      });
    });
  });

  it('saves quiet-hours edits as a structured preference patch', async () => {
    const onPatch = vi.fn(() => Promise.resolve());
    render(
      <NotificationPreferencesSection
        preferences={makeNotificationPreferenceOutFixture({
          quietHours: {
            enabled: false,
            start: '18:00',
            end: '08:00',
            days: ['mon', 'tue', 'wed', 'thu', 'fri'],
            allowUrgent: true,
          },
        })}
        saving={false}
        error={null}
        onPatch={onPatch}
      />,
    );

    fireEvent.click(screen.getByLabelText('Quiet hours'));
    fireEvent.change(screen.getByLabelText('Quiet hours start'), { target: { value: '19:30' } });
    fireEvent.change(screen.getByLabelText('Quiet hours end'), { target: { value: '07:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save quiet hours' }));

    await waitFor(() => {
      expect(onPatch).toHaveBeenCalledWith({
        quietHours: {
          enabled: true,
          start: '19:30',
          end: '07:00',
          days: ['mon', 'tue', 'wed', 'thu', 'fri'],
          allowUrgent: true,
        },
      });
    });
  });

  it('surfaces announcement choices before the advanced channel matrix', async () => {
    const onPatch = vi.fn(() => Promise.resolve());
    render(
      <NotificationPreferencesSection
        preferences={makeNotificationPreferenceOutFixture({
          categories: {
            service_announcement: { web: true, email: true, sms: false, push: false },
          },
        })}
        saving={false}
        error={null}
        onPatch={onPatch}
      />,
    );

    const question = screen.getByRole('heading', {
      name: 'How should Docket reach me for announcements?',
    });
    const advanced = screen.getByRole('heading', { name: 'Advanced channel rules' });

    expect(question.compareDocumentPosition(advanced) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(4);

    fireEvent.click(screen.getByLabelText('Announcement email'));

    await waitFor(() => {
      expect(onPatch).toHaveBeenCalledWith({
        categories: { service_announcement: { email: false } },
      });
    });
  });

  it('saves quiet-hour days and urgent bypass choices', async () => {
    const onPatch = vi.fn(() => Promise.resolve());
    render(
      <NotificationPreferencesSection
        preferences={makeNotificationPreferenceOutFixture({
          quietHours: {
            enabled: true,
            start: '18:00',
            end: '08:00',
            days: ['mon', 'tue', 'wed', 'thu', 'fri'],
            allowUrgent: true,
          },
        })}
        saving={false}
        error={null}
        onPatch={onPatch}
      />,
    );

    fireEvent.click(screen.getByLabelText('Quiet on Saturday'));
    fireEvent.click(screen.getByLabelText('Allow urgent notifications'));
    fireEvent.click(screen.getByRole('button', { name: 'Save quiet hours' }));

    await waitFor(() => {
      expect(onPatch).toHaveBeenCalledWith({
        quietHours: {
          enabled: true,
          start: '18:00',
          end: '08:00',
          days: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat'],
          allowUrgent: false,
        },
      });
    });
  });
});
