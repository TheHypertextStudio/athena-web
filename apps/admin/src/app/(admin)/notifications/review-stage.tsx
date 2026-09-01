'use client';

import { Badge, Stack, Surface, Text } from '@docket/ui/primitives';
import { type JSX } from 'react';

import type { AdminNotificationEstimate, AdminNotificationPreview } from '@/lib/types';
import { CHANNELS } from './compose-stage';

/** Render a suppression reason in staff-facing plain language. */
function formatReason(reason: string): string {
  return reason.replaceAll('_', ' ');
}

/** Props for {@link ReviewStage}. */
export interface ReviewStageProps {
  /** The audience and channel estimate for the selected announcement. */
  readonly estimate: AdminNotificationEstimate | null;
  /** The rendered channel previews for the selected announcement. */
  readonly preview: AdminNotificationPreview | null;
}

/**
 * The second stage: who this actually reaches, and what they will see.
 *
 * @remarks
 * Audience, channel breakdown, and per-channel previews read as one answer to one question rather
 * than three separate cards, because they are all facets of "what happens if I send this". The
 * recipient count leads, since it is the number that decides whether anything else matters.
 *
 * @param props - See {@link ReviewStageProps}.
 * @returns the review stage.
 */
export function ReviewStage({ estimate, preview }: ReviewStageProps): JSX.Element {
  return (
    <Stack gap={6}>
      <Recipients estimate={estimate} />
      <ChannelBreakdown estimate={estimate} />
      <ChannelPreviews preview={preview} />
    </Stack>
  );
}

/** How many people this reaches, and who has been suppressed. */
function Recipients({
  estimate,
}: {
  readonly estimate: AdminNotificationEstimate | null;
}): JSX.Element {
  return (
    <Stack gap={2}>
      <Text as="h3" token="title-small">
        Audience
      </Text>
      <div className="flex flex-wrap items-baseline gap-3">
        <Text as="p" token="headline-small" numeric>
          {estimate ? estimate.recipientCount.toLocaleString() : '—'}
        </Text>
        <Text as="p" token="body-medium" tone="muted">
          {estimate?.recipientCount === 1 ? 'recipient' : 'recipients'}
        </Text>
        <ApprovalBadge estimate={estimate} />
      </div>
      <Suppressions estimate={estimate} />
    </Stack>
  );
}

/** Whether this announcement needs a second operator's approval before it can go. */
function ApprovalBadge({
  estimate,
}: {
  readonly estimate: AdminNotificationEstimate | null;
}): JSX.Element | null {
  if (!estimate) return null;
  if (estimate.approvalRequired) return <Badge variant="destructive">Approval required</Badge>;
  return <Badge variant="secondary">No approval gate</Badge>;
}

/** Who will not receive this, and why. */
function Suppressions({
  estimate,
}: {
  readonly estimate: AdminNotificationEstimate | null;
}): JSX.Element {
  if (!estimate || estimate.suppressions.length === 0) {
    return (
      <Text as="p" token="body-small" tone="muted">
        No suppressions estimated.
      </Text>
    );
  }

  return (
    <Stack gap={1} as="ul">
      {estimate.suppressions.map((suppression) => (
        <li key={`${suppression.channel ?? 'any'}:${suppression.reason}`}>
          <Text as="span" token="body-small" tone="muted">
            {suppression.count} {suppression.channel ?? 'channel'} ·{' '}
            {formatReason(suppression.reason)}
          </Text>
        </li>
      ))}
    </Stack>
  );
}

/** What each channel will send, delay, and suppress. */
function ChannelBreakdown({
  estimate,
}: {
  readonly estimate: AdminNotificationEstimate | null;
}): JSX.Element {
  return (
    <Stack gap={2}>
      <Text as="h3" token="title-small">
        Channels
      </Text>
      <div className="grid grid-cols-2 gap-2 @lg:grid-cols-4">
        {CHANNELS.map((channel) => {
          const counts = estimate?.channelCounts[channel];
          return (
            <Surface key={channel} tone="card" shape="small" pad="comfortable">
              <Stack gap={1}>
                <Text as="p" token="label-medium">
                  {channel}
                </Text>
                <Text as="p" token="body-small" tone="muted" numeric>
                  send {counts?.send ?? 0}
                </Text>
                <Text as="p" token="body-small" tone="muted" numeric>
                  delay {counts?.delay ?? 0}
                </Text>
                <Text as="p" token="body-small" tone="muted" numeric>
                  suppress {counts?.suppress ?? 0}
                </Text>
              </Stack>
            </Surface>
          );
        })}
      </div>
    </Stack>
  );
}

/** What the announcement looks like on each channel it was requested for. */
function ChannelPreviews({
  preview,
}: {
  readonly preview: AdminNotificationPreview | null;
}): JSX.Element {
  return (
    <Stack gap={2}>
      <Text as="h3" token="title-small">
        Preview
      </Text>
      {preview ? (
        <div className="grid gap-2 @lg:grid-cols-2">
          <PreviewPane label="Web" title={preview.web?.title} body={preview.web?.body} />
          <PreviewPane label="Email" title={preview.email?.subject} body={preview.email?.text} />
          <PreviewPane label="SMS" body={preview.sms?.text} />
          <PreviewPane label="Push" title={preview.push?.title} body={preview.push?.body} />
        </div>
      ) : (
        <Text as="p" token="body-small" tone="muted">
          Create or select an announcement to see how it renders per channel.
        </Text>
      )}
    </Stack>
  );
}

/** One channel's rendered announcement. */
function PreviewPane({
  label,
  title,
  body,
}: {
  readonly label: string;
  readonly title?: string | undefined;
  readonly body?: string | undefined;
}): JSX.Element {
  return (
    <Surface tone="card" shape="small" pad="comfortable">
      <Stack gap={1}>
        <Text as="p" token="label-small" tone="muted">
          {label}
        </Text>
        {title ? (
          <Text as="p" token="body-medium">
            {title}
          </Text>
        ) : null}
        <Text as="p" token="body-small" tone="muted" className="line-clamp-3">
          {body ?? 'Not requested'}
        </Text>
      </Stack>
    </Surface>
  );
}
