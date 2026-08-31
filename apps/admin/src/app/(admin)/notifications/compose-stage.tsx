'use client';

import { Button, ControlGroup, Input, Select, Stack, Text, Textarea } from '@docket/ui/primitives';
import { type JSX, type SyntheticEvent } from 'react';

import { AudiencePicker, BroadcastWarning } from './audience-picker';
import {
  notificationAudienceSegments,
  type NotificationAnnouncementDraft,
} from './notification-console-model';

/** The channels an announcement can be delivered on. */
export const CHANNELS = ['web', 'email', 'sms', 'push'] as const;

/** Every audience an announcement can be addressed to, with what each one means. */
const AUDIENCES: readonly {
  readonly value: NotificationAnnouncementDraft['audienceType'];
  readonly label: string;
}[] = [
  { value: 'user', label: 'One person' },
  { value: 'users', label: 'Specific people' },
  { value: 'segment', label: 'A segment' },
  { value: 'all_users', label: 'Everyone' },
];

/** Props for {@link ComposeStage}. */
export interface ComposeStageProps {
  /** The draft being written. */
  readonly draft: NotificationAnnouncementDraft;
  /** Whether the create request is in flight. */
  readonly pending: boolean;
  /** How many recipients the current estimate reports, when there is one. */
  readonly recipientCount: number | undefined;
  /** Update one draft field. */
  readonly onDraftChange: <K extends keyof NotificationAnnouncementDraft>(
    key: K,
    value: NotificationAnnouncementDraft[K],
  ) => void;
  /** Create the draft announcement. */
  readonly onCreateDraft: () => void;
}

/**
 * The first stage: write the announcement and say who it is for.
 *
 * @remarks
 * One column, in the order the decisions are actually made — what it says, who receives it, how it
 * reaches them, and when. The console previously presented this as one card in a mosaic of six
 * equally-weighted panels, which gave an operator no indication that composing came before
 * estimating, or estimating before sending.
 *
 * @param props - See {@link ComposeStageProps}.
 * @returns the compose stage.
 */
export function ComposeStage({
  draft,
  pending,
  recipientCount,
  onDraftChange,
  onCreateDraft,
}: ComposeStageProps): JSX.Element {
  function submit(event: SyntheticEvent<HTMLFormElement>): void {
    event.preventDefault();
    onCreateDraft();
  }

  const incomplete = draft.subject.trim() === '' || draft.bodyText.trim() === '';

  return (
    <form className="flex flex-col gap-5" onSubmit={submit}>
      <Field label="Title" htmlFor="announcement-subject">
        <Input
          id="announcement-subject"
          value={draft.subject}
          onChange={(event) => {
            onDraftChange('subject', event.target.value);
          }}
          placeholder="Scheduled maintenance tonight"
        />
      </Field>

      <Field label="Message" htmlFor="announcement-body">
        <Textarea
          id="announcement-body"
          value={draft.bodyText}
          onChange={(event) => {
            onDraftChange('bodyText', event.target.value);
          }}
          className="min-h-28"
          placeholder="Docket will be briefly unavailable tonight."
        />
      </Field>

      <Audience draft={draft} recipientCount={recipientCount} onDraftChange={onDraftChange} />

      <div className="grid gap-4 @lg:grid-cols-2">
        <Field label="Channels">
          <div className="flex flex-wrap gap-3">
            {CHANNELS.map((channel) => (
              <label key={channel} className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={draft.channels.includes(channel)}
                  onChange={() => {
                    onDraftChange('channels', toggleChannel(draft.channels, channel));
                  }}
                />
                <Text as="span" token="body-small">
                  {channel}
                </Text>
              </label>
            ))}
          </div>
        </Field>

        <Field label="Send at" htmlFor="announcement-schedule">
          <Input
            id="announcement-schedule"
            type="datetime-local"
            value={draft.scheduledAt}
            onChange={(event) => {
              onDraftChange('scheduledAt', event.target.value);
            }}
          />
        </Field>

        <Field label="Priority" htmlFor="announcement-priority">
          <Select
            id="announcement-priority"
            value={draft.priority}
            onChange={(event) => {
              onDraftChange(
                'priority',
                event.target.value as NotificationAnnouncementDraft['priority'],
              );
            }}
          >
            {(['low', 'normal', 'high', 'urgent'] as const).map((priority) => (
              <option key={priority} value={priority}>
                {priority}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Replies go to" htmlFor="announcement-reply-policy">
          <Select
            id="announcement-reply-policy"
            value={draft.replyPolicy}
            onChange={(event) => {
              onDraftChange(
                'replyPolicy',
                event.target.value as NotificationAnnouncementDraft['replyPolicy'],
              );
            }}
          >
            {(['none', 'staff_inbox', 'org_admins', 'automation'] as const).map((policy) => (
              <option key={policy} value={policy}>
                {policy.replaceAll('_', ' ')}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <ControlGroup controlSize="md">
        <Button type="submit" disabled={pending || incomplete}>
          {pending ? 'Creating…' : 'Create draft'}
        </Button>
      </ControlGroup>
      <Text as="p" token="body-small" tone="muted">
        Creating a draft does not send anything. It produces the audience estimate and the channel
        previews you review before sending.
      </Text>
    </form>
  );
}

/** Who the announcement is addressed to, and the control that names them. */
function Audience({
  draft,
  recipientCount,
  onDraftChange,
}: {
  readonly draft: NotificationAnnouncementDraft;
  readonly recipientCount: number | undefined;
  readonly onDraftChange: ComposeStageProps['onDraftChange'];
}): JSX.Element {
  return (
    <Stack gap={2}>
      <Field label="Audience" htmlFor="announcement-audience">
        <Select
          id="announcement-audience"
          value={draft.audienceType}
          onChange={(event) => {
            onDraftChange(
              'audienceType',
              event.target.value as NotificationAnnouncementDraft['audienceType'],
            );
            onDraftChange('audienceValue', '');
          }}
        >
          {AUDIENCES.map((audience) => (
            <option key={audience.value} value={audience.value}>
              {audience.label}
            </option>
          ))}
        </Select>
      </Field>
      <AudienceTarget draft={draft} recipientCount={recipientCount} onDraftChange={onDraftChange} />
    </Stack>
  );
}

/** The control for naming the chosen audience, which differs per audience type. */
function AudienceTarget({
  draft,
  recipientCount,
  onDraftChange,
}: {
  readonly draft: NotificationAnnouncementDraft;
  readonly recipientCount: number | undefined;
  readonly onDraftChange: ComposeStageProps['onDraftChange'];
}): JSX.Element | null {
  if (draft.audienceType === 'all_users') {
    return <BroadcastWarning recipientCount={recipientCount} />;
  }

  if (draft.audienceType === 'segment') {
    return (
      <Field label="Segment" htmlFor="announcement-segment">
        <Select
          id="announcement-segment"
          value={draft.audienceValue}
          onChange={(event) => {
            onDraftChange('audienceValue', event.target.value);
          }}
        >
          {notificationAudienceSegments.map((segment) => (
            <option key={segment} value={segment}>
              {segment.replaceAll('_', ' ')}
            </option>
          ))}
        </Select>
      </Field>
    );
  }

  return (
    <AudiencePicker
      audienceType={draft.audienceType}
      value={draft.audienceValue}
      onChange={(value) => {
        onDraftChange('audienceValue', value);
      }}
    />
  );
}

/** A labelled form field. */
function Field({
  label,
  htmlFor,
  children,
}: {
  readonly label: string;
  readonly htmlFor?: string | undefined;
  readonly children: JSX.Element;
}): JSX.Element {
  return (
    <Stack gap={1}>
      <Text as="label" token="label-medium" {...(htmlFor ? { htmlFor } : {})}>
        {label}
      </Text>
      {children}
    </Stack>
  );
}

/** Add or remove a channel from the draft's selection. */
function toggleChannel(
  selected: NotificationAnnouncementDraft['channels'],
  channel: NotificationAnnouncementDraft['channels'][number],
): NotificationAnnouncementDraft['channels'] {
  if (selected.includes(channel)) return selected.filter((item) => item !== channel);
  return [...selected, channel];
}
