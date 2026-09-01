import '@testing-library/jest-dom/vitest';

import {
  ContactPointOut as ContactPointOutSchema,
  type ContactPointOut,
} from '@docket/notifications/schemas';
import { makeContactPointOutFixture } from '@docket/notifications/testing';
import { ContactPointId } from '@docket/notifications/ids';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ContactPointsSection } from '../../../src/components/settings/contact-points-section';

const EMAIL_PRIMARY_ID = ContactPointId.parse('01ARZ3NDEKTSV4RRFFQ69G5FAV');
const PHONE_PENDING_ID = ContactPointId.parse('01BX5ZZKBKACTAV9WEVGEMMVRZ');
const EMAIL_BOUNCED_ID = ContactPointId.parse('01D78XYFJ1PRM1WPBCBT3VHMNV');
const PHONE_UNSUBSCRIBED_ID = ContactPointId.parse('01F8MECHZX3TBDSZ7XRADM79XV');

afterEach(cleanup);

function contactPoint(
  overrides: Parameters<typeof makeContactPointOutFixture>[0],
): ContactPointOut {
  return ContactPointOutSchema.parse(makeContactPointOutFixture(overrides));
}

describe('ContactPointsSection', () => {
  it('shows phone verification and provider failure states without hiding the destination', () => {
    render(
      <ContactPointsSection
        contactPoints={[
          contactPoint({
            id: EMAIL_PRIMARY_ID,
            type: 'email',
            value: 'ada@x.test',
            status: 'active',
            primary: true,
          }),
          contactPoint({
            id: PHONE_PENDING_ID,
            type: 'phone',
            value: '+15550123',
            status: 'pending',
            primary: false,
            verifiedAt: null,
          }),
          contactPoint({
            id: EMAIL_BOUNCED_ID,
            type: 'email',
            value: 'bee@x.test',
            status: 'bounced',
            primary: false,
          }),
          contactPoint({
            id: PHONE_UNSUBSCRIBED_ID,
            type: 'phone',
            value: '+15550456',
            status: 'unsubscribed',
            primary: false,
          }),
        ]}
        creating={false}
        savingId={null}
        verifyingId={null}
        error={null}
        onAdd={vi.fn()}
        onVerify={vi.fn()}
        onMakePrimary={vi.fn()}
        onDisable={vi.fn()}
      />,
    );

    expect(screen.getByText('Primary')).toBeInTheDocument();
    expect(screen.getByText('Verification pending')).toBeInTheDocument();
    expect(screen.getByText('Bounced')).toBeInTheDocument();
    expect(screen.getByText('Unsubscribed')).toBeInTheDocument();
    expect(screen.getByText('+15550123')).toBeInTheDocument();
  });

  it('verifies a pending phone number with the entered code', async () => {
    const onVerify = vi.fn(() => Promise.resolve());
    render(
      <ContactPointsSection
        contactPoints={[
          contactPoint({
            id: PHONE_PENDING_ID,
            type: 'phone',
            value: '+15550123',
            status: 'pending',
            primary: false,
            verifiedAt: null,
          }),
        ]}
        creating={false}
        savingId={null}
        verifyingId={null}
        error={null}
        onAdd={vi.fn()}
        onVerify={onVerify}
        onMakePrimary={vi.fn()}
        onDisable={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText('Verification code for +15550123'), {
      target: { value: '000000' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Verify +15550123' }));

    await waitFor(() => {
      expect(onVerify).toHaveBeenCalledWith(PHONE_PENDING_ID, '000000');
    });
  });

  it('adds an email contact point from the shared destination form', async () => {
    const onAdd = vi.fn(() => Promise.resolve());
    render(
      <ContactPointsSection
        contactPoints={[]}
        creating={false}
        savingId={null}
        verifyingId={null}
        error={null}
        onAdd={onAdd}
        onVerify={vi.fn()}
        onMakePrimary={vi.fn()}
        onDisable={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Add email address' }));
    fireEvent.change(screen.getByLabelText('Email address'), {
      target: { value: 'alerts@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));

    await waitFor(() => {
      expect(onAdd).toHaveBeenCalledWith({
        type: 'email',
        value: 'alerts@example.com',
        purpose: 'email_notifications',
      });
    });
  });

  it('requires confirmation before disabling a contact point', () => {
    const onDisable = vi.fn();
    render(
      <ContactPointsSection
        contactPoints={[
          contactPoint({
            id: EMAIL_PRIMARY_ID,
            type: 'email',
            value: 'ada@x.test',
            status: 'active',
            primary: true,
          }),
        ]}
        creating={false}
        savingId={null}
        verifyingId={null}
        error={null}
        onAdd={vi.fn()}
        onVerify={vi.fn()}
        onMakePrimary={vi.fn()}
        onDisable={onDisable}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Disable ada@x.test' }));
    expect(onDisable).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Confirm disable ada@x.test' }));
    expect(onDisable).toHaveBeenCalledWith(EMAIL_PRIMARY_ID);
  });
});
