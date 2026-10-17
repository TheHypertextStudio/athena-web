'use client';

import type { AthenaMailChannelOut } from '@docket/athena/athena-mail-contract';
import { OrganizationId } from '@docket/identity-access/ids';
import { Button, Checkbox, Field, Select, Skeleton, Surface, Text } from '@docket/ui/primitives';
import { type JSX, useState } from 'react';
import { useApiMutation, useApiQuery } from '@/lib/query';
import { unwrap } from '@/lib/query-core';
import {
  mailChannelDef,
  mailChannelKey,
  mailOutboxKey,
  mailWorkspacesDef,
  updateMailChannel,
} from './mail-query-defs';

/** Explicit email enrollment, verified-owner replies and revocation controls. */
export function MailChannelCard(): JSX.Element {
  const channelQ = useApiQuery(mailChannelDef());
  const workspacesQ = useApiQuery(mailWorkspacesDef());
  if (channelQ.isPending) return <Skeleton className="h-52 w-full rounded-xl" />;
  if (!channelQ.data || channelQ.error)
    return (
      <Text as="p" token="body-small" tone="error" role="alert">
        Could not load email settings. Try again when you reconnect.
      </Text>
    );
  const channel = channelQ.data;
  return (
    <Surface tone="card" shape="medium" pad="roomy" className="flex flex-col gap-4">
      <div>
        <Text as="h2" token="title-medium">
          Email Athena
        </Text>
        <Text as="p" token="body-small" tone="muted">
          Send a request, then carry on. Athena can work and reply while Docket is closed.
        </Text>
      </div>
      {workspacesQ.error ? (
        <Text as="p" token="body-small" tone="error">
          Could not load your workspaces. You can still turn off email conversations.
        </Text>
      ) : null}
      <ChannelForm
        key={`${channel.enabled}:${channel.ownerRepliesEnabled}:${channel.organizationId}:${channel.ownerAddress}`}
        channel={channel}
        workspaces={workspacesQ.data?.items ?? []}
      />
    </Surface>
  );
}

function ChannelForm({
  channel,
  workspaces,
}: {
  readonly channel: AthenaMailChannelOut;
  readonly workspaces: readonly { readonly id: string; readonly name: string }[];
}): JSX.Element {
  const [enabled, setEnabled] = useState(channel.enabled);
  const [ownerRepliesEnabled, setOwnerRepliesEnabled] = useState(channel.ownerRepliesEnabled);
  const [organizationId, setOrganizationId] = useState(channel.organizationId ?? '');
  const saveM = useApiMutation({
    mutationFn: () =>
      unwrap(
        () =>
          updateMailChannel({
            enabled,
            ownerRepliesEnabled: enabled && ownerRepliesEnabled,
            organizationId: organizationId ? OrganizationId.parse(organizationId) : null,
          }),
        'Could not save email settings.',
      ),
    invalidateKeys: [mailChannelKey, mailOutboxKey],
  });
  const controls = channelControls(
    channel,
    enabled,
    ownerRepliesEnabled,
    saveM.isPending,
    organizationId,
  );
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        saveM.reset();
        saveM.mutate(undefined);
      }}
    >
      <ChannelIdentity channel={channel} />
      <WorkspaceChoice
        value={organizationId}
        previous={channel.organizationId}
        workspaces={workspaces}
        disabled={saveM.isPending}
        onChange={(value) => {
          setOrganizationId(value);
          saveM.reset();
        }}
      />
      <ConsentChoice
        label="Enable email conversations"
        checked={enabled}
        disabled={controls.enableDisabled}
        onChange={(value) => {
          setEnabled(value);
          saveM.reset();
        }}
      />
      <ConsentChoice
        label="Automatically reply to me"
        checked={enabled && ownerRepliesEnabled}
        disabled={controls.repliesDisabled}
        onChange={(value) => {
          setOwnerRepliesEnabled(value);
          saveM.reset();
        }}
      />
      <ChannelSave
        failed={Boolean(saveM.error)}
        pending={saveM.isPending}
        disabled={controls.saveDisabled}
        saved={saveM.isSuccess}
      />
    </form>
  );
}

function ChannelSave({
  failed,
  pending,
  disabled,
  saved,
}: {
  readonly failed: boolean;
  readonly pending: boolean;
  readonly disabled: boolean;
  readonly saved: boolean;
}): JSX.Element {
  return (
    <>
      <Text as="p" token="body-small" tone="muted">
        Email conversations require automatic replies to your verified account email. Emailing
        anyone else requires your approval in Docket. Forwarded messages are context, not permission
        to act. Turning email off cancels queued replies; emails already sent cannot be recalled.
      </Text>
      {failed ? (
        <Text as="p" token="body-small" tone="error" role="alert">
          Could not save email settings. Your changes are still here; try again.
        </Text>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={disabled}>
          {pending ? 'Saving…' : 'Save email settings'}
        </Button>
        {saved ? (
          <Text role="status" token="body-small">
            Email settings saved.
          </Text>
        ) : null}
      </div>
    </>
  );
}

function channelControls(
  channel: AthenaMailChannelOut,
  enabled: boolean,
  ownerRepliesEnabled: boolean,
  pending: boolean,
  organizationId: string,
) {
  const ready = channel.configured && Boolean(channel.ownerAddress);
  return {
    enableDisabled: pending || (!ready && !enabled),
    repliesDisabled: !enabled || !ready || pending,
    saveDisabled: pending || !canSaveChannel(channel, enabled, ownerRepliesEnabled, organizationId),
  };
}

function canSaveChannel(
  channel: AthenaMailChannelOut,
  enabled: boolean,
  ownerRepliesEnabled: boolean,
  organizationId: string,
): boolean {
  if (!enabled) return channel.enabled || channel.configured;
  if (!organizationId) return false;
  return channel.configured && Boolean(channel.ownerAddress) && ownerRepliesEnabled;
}

function WorkspaceChoice({
  value,
  previous,
  workspaces,
  disabled,
  onChange,
}: {
  readonly value: string;
  readonly previous: string | null;
  readonly workspaces: readonly { readonly id: string; readonly name: string }[];
  readonly disabled: boolean;
  readonly onChange: (value: string) => void;
}): JSX.Element {
  return (
    <Field label="Workspace for email requests">
      <Select
        value={value}
        disabled={disabled}
        onChange={(event) => {
          onChange(event.currentTarget.value);
        }}
      >
        <option value="">Choose a workspace</option>
        {previous && !workspaces.some((workspace) => workspace.id === previous) ? (
          <option value={previous}>Previous workspace (access unavailable)</option>
        ) : null}
        {workspaces.map((workspace) => (
          <option key={workspace.id} value={workspace.id}>
            {workspace.name}
          </option>
        ))}
      </Select>
    </Field>
  );
}

function ConsentChoice({
  label,
  checked,
  disabled,
  onChange,
}: {
  readonly label: string;
  readonly checked: boolean;
  readonly disabled: boolean;
  readonly onChange: (value: boolean) => void;
}): JSX.Element {
  return (
    <label className="flex min-h-10 cursor-pointer items-center gap-3">
      <Checkbox
        checked={checked}
        disabled={disabled}
        onChange={(event) => {
          onChange(event.currentTarget.checked);
        }}
      />
      <Text token="body-medium">{label}</Text>
    </label>
  );
}

function ChannelIdentity({ channel }: { readonly channel: AthenaMailChannelOut }): JSX.Element {
  return (
    <div className="flex flex-col gap-2">
      {channel.ownerAddress ? (
        <Text as="p" token="body-small">
          Your verified email: <strong className="break-all">{channel.ownerAddress}</strong>
        </Text>
      ) : (
        <Text as="p" token="body-small">
          Verify your account email before enabling email conversations. A verified account email is
          required to keep replies private.
        </Text>
      )}
      {!channel.configured ? (
        <Text as="p" token="body-small" tone="muted">
          Email sending and receiving are not ready yet. You can still turn off an existing email
          connection.
        </Text>
      ) : null}
      {channel.configured && channel.address ? (
        <ChannelAddress
          address={channel.address}
          active={channel.enabled && channel.ownerRepliesEnabled}
        />
      ) : null}
    </div>
  );
}

function ChannelAddress({
  address,
  active,
}: {
  readonly address: string;
  readonly active: boolean;
}): JSX.Element {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const testHref = `mailto:${encodeURIComponent(address)}?subject=Hello%20Athena&body=Please%20reply%20to%20confirm%20that%20my%20Athena%20email%20connection%20works.`;
  return (
    <>
      <Text as="p" token="body-large" className="font-mono break-all">
        {address}
      </Text>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="secondary"
          controlSize="sm"
          onClick={() => {
            void navigator.clipboard.writeText(address).then(
              () => {
                setCopyState('copied');
              },
              () => {
                setCopyState('failed');
              },
            );
          }}
        >
          {copyState === 'copied' ? 'Copied address' : 'Copy address'}
        </Button>
        {active ? (
          <a href={testHref} className="text-primary underline">
            Send a test email
          </a>
        ) : null}
      </div>
      {active ? (
        <Text as="p" token="body-small" tone="muted">
          Send the test from your verified email above. A reply in your mailbox confirms the
          connection.
        </Text>
      ) : null}
      {copyState === 'failed' ? (
        <Text role="status" token="body-small">
          Could not copy. Select the address above to copy it.
        </Text>
      ) : null}
    </>
  );
}
