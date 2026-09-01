'use client';

import { Button, ControlGroup, Stack, Text } from '@docket/ui/primitives';
import { type JSX } from 'react';

import { ConfirmButton } from '@/components/confirm-button';
import { Property, PropertyList } from '@/components/admin-detail';
import type { AdminNotificationEstimate, AdminNotificationIntent } from '@/lib/types';

/** Props for {@link SendStage}. */
export interface SendStageProps {
  /** The announcement being decided on. */
  readonly intent: AdminNotificationIntent;
  /** The audience estimate, which says how far this reaches. */
  readonly estimate: AdminNotificationEstimate | null;
  /**
   * The action currently in flight, if any.
   *
   * @remarks
   * Also decides whether the controls are available: anything in flight disables all of them, so a
   * separate `disabled` prop would be a second copy of this fact that could disagree with it.
   */
  readonly pendingAction: string | null;
  /** Send a test copy to the operator. */
  readonly onTestSend: () => void;
  /** Approve a draft or scheduled announcement. */
  readonly onApprove: () => void;
  /** Send the announcement now. */
  readonly onSendNow: () => void;
  /** Cancel the announcement. */
  readonly onCancel: () => void;
}

/**
 * The final stage: the decision to actually send.
 *
 * @remarks
 * Sending is the one irreversible thing this console does — a delivered announcement cannot be
 * recalled — so it asks first, and the question names how many people it reaches. Previously
 * "Send now" sat in a row of four visually identical buttons and fired on a single click.
 *
 * Testing to yourself and cancelling are safe, so neither asks. Cancelling is still confirmed
 * because it discards work an operator may have scheduled deliberately.
 *
 * @param props - See {@link SendStageProps}.
 * @returns the send stage.
 */
export function SendStage({
  intent,
  estimate,
  pendingAction,
  onTestSend,
  onApprove,
  onSendNow,
  onCancel,
}: SendStageProps): JSX.Element {
  const disabled = pendingAction !== null;

  return (
    <Stack gap={4}>
      <PropertyList>
        <Property label="Status" value={intent.status.replaceAll('_', ' ')} truncate />
        <Property label="Category" value={intent.category.replaceAll('_', ' ')} truncate />
        <Property
          label="Approval"
          value={estimate?.approvalRequired ? 'Required' : 'Not required'}
          truncate
        />
      </PropertyList>

      <Stack gap={2}>
        <Text as="p" token="body-small" tone="muted">
          {reachLine(estimate)}
        </Text>

        <ControlGroup controlSize="md" wrap>
          <Button variant="secondary" disabled={disabled} onClick={onTestSend}>
            {pendingAction === 'test' ? 'Sending…' : 'Send test to me'}
          </Button>
          <Button variant="secondary" disabled={disabled} onClick={onApprove}>
            {pendingAction === 'approve' ? 'Approving…' : 'Approve'}
          </Button>
          <ConfirmButton
            label={pendingAction === 'send' ? 'Sending…' : 'Send now'}
            disabled={disabled}
            title="Send this announcement?"
            description={`${sendConsequence(estimate)} A delivered announcement cannot be recalled.`}
            confirmLabel="Send now"
            onConfirm={onSendNow}
          />
          <ConfirmButton
            label={pendingAction === 'cancel' ? 'Canceling…' : 'Cancel announcement'}
            disabled={disabled}
            title="Cancel this announcement?"
            description="It will not be sent, and a scheduled send is called off. The draft stays in the list."
            confirmLabel="Cancel announcement"
            onConfirm={onCancel}
          />
        </ControlGroup>
      </Stack>
    </Stack>
  );
}

/** How far this announcement reaches, stated before the send controls. */
function reachLine(estimate: AdminNotificationEstimate | null): string {
  if (!estimate) return 'No audience estimate yet — create or reselect the announcement.';
  const people = estimate.recipientCount.toLocaleString();
  const noun = estimate.recipientCount === 1 ? 'person receives' : 'people receive';
  return `${people} ${noun} this on the channels it requested.`;
}

/** What the confirmation says the send will do. */
function sendConsequence(estimate: AdminNotificationEstimate | null): string {
  if (!estimate) return 'This sends the announcement to its audience immediately.';
  const people = estimate.recipientCount.toLocaleString();
  const noun = estimate.recipientCount === 1 ? 'person' : 'people';
  return `This delivers the announcement to ${people} ${noun} immediately.`;
}
