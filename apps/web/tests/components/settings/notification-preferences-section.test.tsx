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

  it('autosaves quiet-hours edits as a structured preference patch — no Save button', async () => {
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

    expect(screen.queryByRole('button', { name: 'Save quiet hours' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Turn quiet hours on'));
    fireEvent.change(screen.getByLabelText('Quiet hours start'), { target: { value: '19:30' } });
    fireEvent.change(screen.getByLabelText('Quiet hours end'), { target: { value: '07:00' } });

    await waitFor(
      () => {
        expect(onPatch).toHaveBeenCalledWith({
          quietHours: {
            enabled: true,
            start: '19:30',
            end: '07:00',
            days: ['mon', 'tue', 'wed', 'thu', 'fri'],
            allowUrgent: true,
          },
        });
      },
      { timeout: 2000 },
    );
  });

  it('edits service announcements from the one matrix that owns every category', async () => {
    // Announcements used to have a promoted group of its own *and* a row in the matrix below —
    // one setting with two controls on one screen. The matrix is the single place now, so this
    // asserts the category is still reachable and still patches the same shape.
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

    fireEvent.click(screen.getByLabelText('Email for Service announcements'));

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

    await waitFor(
      () => {
        expect(onPatch).toHaveBeenCalledWith({
          quietHours: {
            enabled: true,
            start: '18:00',
            end: '08:00',
            days: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat'],
            allowUrgent: false,
          },
        });
      },
      { timeout: 2000 },
    );
  });
});
