import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeQueryWrapper, okResponse } from '../support/query';

const handlers = vi.hoisted(() => ({
  channel: vi.fn(),
  save: vi.fn(),
  outbox: vi.fn(),
  organizations: vi.fn(),
}));
vi.mock('../../src/lib/api', () => ({
  api: {
    v1: {
      me: {
        athena: {
          mail: {
            channel: {
              $get: handlers.channel,
              $put: handlers.save,
              outbox: { $get: handlers.outbox },
            },
          },
        },
      },
    },
  },
}));
vi.mock('../../src/lib/org-collection-pages', () => ({
  fetchAllOrganizations: handlers.organizations,
}));
import { MailChannelCard } from '../../src/components/athena/mail-channel-card';
import { MailOutbox } from '../../src/components/athena/mail-outbox';

const channel = {
  enabled: false,
  ownerRepliesEnabled: false,
  organizationId: null,
  ownerAddress: 'owner@example.com',
  address: 'athena@example.com',
  configured: true,
};
function show(element: React.ReactElement) {
  return render(element, { wrapper: makeQueryWrapper().wrapper });
}
afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  handlers.channel.mockResolvedValue(okResponse(channel));
  handlers.save.mockResolvedValue(okResponse(channel));
  handlers.organizations.mockResolvedValue(
    okResponse({
      items: [{ id: '01KY2ZK3JXKTE6RENXVVJN2Y19', name: 'Studio' }],
    }),
  );
});
describe('Athena email setup', () => {
  it('requires explicit channel and owner reply consent before saving', async () => {
    show(<MailChannelCard />);
    expect(await screen.findByLabelText('Enable email conversations')).not.toBeChecked();
    expect(screen.getByLabelText('Automatically reply to me')).not.toBeChecked();
    fireEvent.change(screen.getByLabelText('Workspace for email requests'), {
      target: { value: '01KY2ZK3JXKTE6RENXVVJN2Y19' },
    });
    fireEvent.click(screen.getByLabelText('Enable email conversations'));
    expect(screen.getByRole('button', { name: 'Save email settings' })).toBeDisabled();
    fireEvent.click(screen.getByLabelText('Automatically reply to me'));
    fireEvent.click(screen.getByRole('button', { name: 'Save email settings' }));
    await waitFor(() => {
      expect(handlers.save).toHaveBeenCalledWith({
        json: {
          enabled: true,
          ownerRepliesEnabled: true,
          organizationId: '01KY2ZK3JXKTE6RENXVVJN2Y19',
        },
      });
    });
    expect(screen.getByText('owner@example.com')).toBeInTheDocument();
  });
  it('does not offer enabling an unconfigured channel', async () => {
    handlers.channel.mockResolvedValue(
      okResponse({ ...channel, configured: false, address: null }),
    );
    show(<MailChannelCard />);
    expect(await screen.findByLabelText('Enable email conversations')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Save email settings' })).toBeDisabled();
    expect(screen.queryByRole('link', { name: 'Send a test email' })).not.toBeInTheDocument();
  });
  it('requires a verified owner address', async () => {
    handlers.channel.mockResolvedValue(okResponse({ ...channel, ownerAddress: null }));
    show(<MailChannelCard />);
    expect(await screen.findByLabelText('Enable email conversations')).toBeDisabled();
    expect(screen.getByText(/Verify your account email/)).toBeInTheDocument();
  });
  it('opens a real test email only after owner replies are enabled', async () => {
    handlers.channel.mockResolvedValue(
      okResponse({
        ...channel,
        enabled: true,
        ownerRepliesEnabled: true,
        organizationId: '01KY2ZK3JXKTE6RENXVVJN2Y19',
      }),
    );
    show(<MailChannelCard />);
    const test = await screen.findByRole('link', { name: 'Send a test email' });
    expect(test.getAttribute('href')).toContain('mailto:athena%40example.com');
    expect(test.getAttribute('href')).toContain('subject=Hello%20Athena');
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });
  it('keeps unsaved consent when saving fails and hides provider diagnostics', async () => {
    handlers.save.mockRejectedValue(new Error('secret provider diagnostic'));
    show(<MailChannelCard />);
    fireEvent.change(await screen.findByLabelText('Workspace for email requests'), {
      target: { value: '01KY2ZK3JXKTE6RENXVVJN2Y19' },
    });
    fireEvent.click(screen.getByLabelText('Enable email conversations'));
    fireEvent.click(screen.getByLabelText('Automatically reply to me'));
    fireEvent.click(screen.getByRole('button', { name: 'Save email settings' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Your changes are still here');
    expect(screen.getByLabelText('Enable email conversations')).toBeChecked();
    expect(screen.queryByText('secret provider diagnostic')).not.toBeInTheDocument();
  });
  it('can revoke after losing the workspace even when membership loading fails', async () => {
    handlers.channel.mockResolvedValue(
      okResponse({
        ...channel,
        enabled: true,
        ownerRepliesEnabled: true,
        organizationId: null,
        ownerAddress: null,
      }),
    );
    handlers.organizations.mockRejectedValue(new Error('membership lookup unavailable'));
    show(<MailChannelCard />);
    fireEvent.click(await screen.findByLabelText('Enable email conversations'));
    fireEvent.click(screen.getByRole('button', { name: 'Save email settings' }));
    await waitFor(() => {
      expect(handlers.save).toHaveBeenCalledWith({
        json: { enabled: false, ownerRepliesEnabled: false, organizationId: null },
      });
    });
  });
  it('allows revocation when provider configuration is unavailable', async () => {
    handlers.channel.mockResolvedValue(
      okResponse({
        ...channel,
        enabled: true,
        ownerRepliesEnabled: true,
        organizationId: '01KY2ZK3JXKTE6RENXVVJN2Y19',
        configured: false,
      }),
    );
    show(<MailChannelCard />);
    fireEvent.click(await screen.findByLabelText('Enable email conversations'));
    fireEvent.click(screen.getByRole('button', { name: 'Save email settings' }));
    await waitFor(() => {
      expect(handlers.save).toHaveBeenCalledWith({
        json: {
          enabled: false,
          ownerRepliesEnabled: false,
          organizationId: '01KY2ZK3JXKTE6RENXVVJN2Y19',
        },
      });
    });
  });
});
describe('Athena email delivery', () => {
  it('distinguishes provider acceptance from delivery and explains uncertain sends', async () => {
    handlers.outbox.mockResolvedValue(
      okResponse({
        items: ['sent', 'delivered', 'uncertain'].map((status) => ({
          id: status,
          inboundMessageId: null,
          sessionId: status === 'sent' ? 'session_1' : null,
          toAddress: 'owner@example.com',
          subject: `Email ${status}`,
          status,
          errorCode: null,
          createdAt: '2026-10-16T12:00:00Z',
          sentAt: null,
        })),
      }),
    );
    show(<MailOutbox />);
    expect(await screen.findByText('Provider accepted')).toBeInTheDocument();
    expect(screen.getByText('Delivered')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open Athena' })).toHaveAttribute(
      'href',
      '/athena?session=session_1',
    );
    expect(screen.getByText(/Delivery is uncertain/)).toBeInTheDocument();
  });
});
