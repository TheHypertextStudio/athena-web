'use client';

/**
 * `settings/athena` — run Athena on your own computer.
 *
 * @remarks
 * The whole management surface for the Lovelace Lattice backend: connect, see which of your
 * computers is answering and whether it is awake, switch computers, turn it off, disconnect.
 *
 * ## The two design rules this section is built around
 *
 * 1. **Every state says something true and something you can do.** There is no dead read-only row
 *    here. "Asleep" is followed by "wake it and make sure Lattice is running"; "not connected" is
 *    followed by a Connect button. Reasons arrive from the API as stable codes and are turned into
 *    words by {@link LATTICE_REASON_COPY} — no gateway text is ever rendered.
 * 2. **Turnkey means three clicks.** Connect → approve on Lovelace → pick a computer. There is no
 *    field anywhere in this section for a URL, a key, or a token, and nothing asks anyone to open a
 *    terminal.
 */
import { CheckCircle2, CircleDashed, CloudOff, RefreshCw, XCircle } from '@docket/ui/icons';
import { Button, Chip, ControlGroup, Skeleton, Stack, Text, Toolbar } from '@docket/ui/primitives';
import { useAppSearchParams } from '@/lib/app-location';
import { type JSX, type ReactNode } from 'react';

import { api } from '@/lib/api';
import { LoadFailure } from '@/components/settings/load-failure';
import { SettingsGroup } from '@/components/settings/settings-group';
import { userErrorMessage } from '@/lib/problem';
import {
  apiQueryOptions,
  queryKeys,
  STALE,
  unwrap,
  useApiMutation,
  useApiQuery,
} from '@/lib/query';

import {
  LATTICE_DEPLOYMENT_COPY,
  LATTICE_DEVICE_STATUS_COPY,
  LATTICE_REASON_COPY,
  LATTICE_RETURN_COPY,
  type LatticeDeploymentReason,
  type LatticeReason,
} from './lattice-copy';

/** The device states the API reports. */
type DeviceStatus = 'unpaired' | 'reachable' | 'offline' | 'revoked';

/** The leading glyph for one device state. */
function deviceIcon(status: DeviceStatus): ReactNode {
  switch (status) {
    case 'reachable':
      return <CheckCircle2 />;
    case 'offline':
      return <CloudOff />;
    case 'unpaired':
      return <CircleDashed />;
    case 'revoked':
      return <XCircle />;
  }
}

/** One line of state plus the action that resolves it. */
function ReasonNote({ reason }: { readonly reason: LatticeReason }): JSX.Element {
  const copy = LATTICE_REASON_COPY[reason];
  return (
    <Stack gap={1}>
      <Text token="body-medium" role="status">
        {copy.title}
      </Text>
      <Text token="body-small" tone="muted">
        {copy.action}
      </Text>
    </Stack>
  );
}

/**
 * Settings → Athena → run Athena on your own computer.
 *
 * @returns The Lattice management section.
 */
export function LatticeSection(): JSX.Element {
  const searchParams = useAppSearchParams();
  const returned = searchParams.get('lattice');
  const statusQ = useApiQuery(
    apiQueryOptions(
      queryKeys.latticeConnection(),
      () => api.v1.me.athena.lattice.$get(),
      'Could not load your Lattice connection.',
      { staleTime: STALE.volatile },
    ),
  );
  const status = statusQ.data ?? null;
  const connected = status?.connected ?? false;

  // Devices are only asked for once a grant exists — there is nothing to list before that, and
  // asking would spend a gateway round trip to learn what the status already said.
  const devicesQ = useApiQuery(
    apiQueryOptions(
      queryKeys.latticeDevices(),
      () => api.v1.me.athena.lattice.devices.$get(),
      'Could not load your computers.',
      { staleTime: STALE.volatile, enabled: connected },
    ),
  );

  const authorize = useApiMutation<{ authorizationUrl: string }, undefined>({
    mutationFn: () =>
      unwrap(
        () => api.v1.me.athena.lattice.authorize.$post(),
        'Could not start the Lovelace connection.',
      ),
    onSuccess: (data) => {
      // A full navigation, not a popup: the consent screen is Lovelace's own page and the
      // person should see its address bar.
      window.location.assign(data.authorizationUrl);
    },
  });

  const chooseDevice = useApiMutation<unknown, string>({
    mutationFn: (deviceId) =>
      unwrap(
        () => api.v1.me.athena.lattice.device.$post({ json: { deviceId } }),
        'Could not switch Athena to that computer.',
      ),
    invalidateKeys: [queryKeys.latticeConnection(), queryKeys.latticeDevices()],
  });

  const setEnabled = useApiMutation<unknown, boolean>({
    mutationFn: (enabled) =>
      unwrap(
        () => api.v1.me.athena.lattice.$patch({ json: { enabled } }),
        'Could not change where Athena runs.',
      ),
    invalidateKeys: [queryKeys.latticeConnection()],
  });

  const disconnect = useApiMutation<unknown, undefined>({
    mutationFn: () =>
      unwrap(() => api.v1.me.athena.lattice.$delete(), 'Could not disconnect Lovelace.'),
    invalidateKeys: [queryKeys.latticeConnection(), queryKeys.latticeDevices()],
  });

  // One slot for whichever write just failed: they are mutually exclusive in practice (each is
  // driven by a single control) and four separate lines would reserve space for three that are
  // always empty.
  const actionError = authorize.isError
    ? userErrorMessage(authorize.error, 'Could not start the Lovelace connection.')
    : chooseDevice.isError
      ? userErrorMessage(chooseDevice.error, 'Could not switch Athena to that computer.')
      : setEnabled.isError
        ? userErrorMessage(setEnabled.error, 'Could not change where Athena runs.')
        : disconnect.isError
          ? userErrorMessage(disconnect.error, 'Could not disconnect Lovelace.')
          : null;

  if (statusQ.isPending) {
    return (
      // placeholder: whether this person has authorized Lovelace and which of their computers is
      // chosen — both are per-account facts only the stored record knows.
      <SettingsGroup title="Run Athena on your own computer">
        <Skeleton className="h-40 rounded-xl" />
      </SettingsGroup>
    );
  }

  if (statusQ.isError || !status) {
    return (
      <SettingsGroup title="Run Athena on your own computer">
        <LoadFailure
          message={userErrorMessage(statusQ.error, 'Could not load this setting.')}
          retrying
        />
      </SettingsGroup>
    );
  }

  // A deployment that cannot offer the feature says so once and renders no controls, rather than
  // showing a Connect button that dead-ends.
  if (!status.available) {
    const reason: LatticeDeploymentReason = status.deploymentReason ?? 'not_configured';
    return (
      <SettingsGroup title="Run Athena on your own computer">
        <Text token="body-medium" tone="muted" role="status">
          {LATTICE_DEPLOYMENT_COPY[reason]}
        </Text>
      </SettingsGroup>
    );
  }

  const devices = devicesQ.data?.devices ?? [];
  const listReason: LatticeReason | null = devicesQ.data?.unavailableReason ?? null;
  const statusReason: LatticeReason | null = status.unavailableReason ?? null;
  // The chosen device's own live state is a reason in its own right. Without this, picking a
  // machine that happens to be asleep leaves the section silently claiming Athena runs there.
  const chosen = devices.find((device) => device.id === status.deviceId) ?? null;
  const chosenReason: LatticeReason | null =
    chosen && !chosen.ready
      ? chosen.status === 'revoked'
        ? 'device_revoked'
        : chosen.status === 'unpaired'
          ? 'device_unpaired'
          : 'device_offline'
      : null;
  const reason =
    listReason ??
    chosenReason ??
    statusReason ??
    (connected && !status.deviceId ? 'no_device_selected' : null);
  const runningHere = status.enabled && status.deviceId !== null && chosenReason === null;
  // The return flag lives in the URL and survives every later interaction, so it is suppressed
  // once its instruction has been carried out — telling someone to "choose a computer" under a
  // list where they already did reads as a broken screen.
  const returnNote =
    returned && !(returned === 'connected' && status.deviceId)
      ? LATTICE_RETURN_COPY[returned]
      : undefined;

  return (
    <SettingsGroup
      title="Run Athena on your own computer"
      description="Athena runs on a computer you own."
      action={
        connected ? (
          <Button
            variant="ghost"
            onClick={() => {
              disconnect.mutate(undefined);
            }}
            disabled={disconnect.isPending}
          >
            Disconnect
          </Button>
        ) : (
          <Button
            onClick={() => {
              authorize.mutate(undefined);
            }}
            disabled={authorize.isPending}
          >
            Connect Lovelace
          </Button>
        )
      }
    >
      {returnNote ? (
        <Text token="body-medium" role="status">
          {returnNote}
        </Text>
      ) : null}

      {connected ? (
        <Stack gap={4}>
          <Toolbar
            leading={
              <Text token="label-large">
                {status.deviceName ? `Athena runs on ${status.deviceName}` : 'Your computers'}
              </Text>
            }
            trailing={
              <ControlGroup>
                <Button
                  variant="ghost"
                  iconOnly
                  aria-label="Refresh your computers"
                  onClick={() => {
                    void devicesQ.refetch();
                  }}
                  disabled={devicesQ.isFetching}
                >
                  <RefreshCw />
                </Button>
                {status.deviceId ? (
                  <Button
                    variant={status.enabled ? 'secondary' : 'default'}
                    onClick={() => {
                      setEnabled.mutate(!status.enabled);
                    }}
                    disabled={setEnabled.isPending}
                  >
                    {status.enabled ? 'Turn off' : 'Turn on'}
                  </Button>
                ) : null}
              </ControlGroup>
            }
          />

          {devicesQ.isPending ? (
            /* placeholder: the list of computers paired to this person's Lovelace account, which
               only the gateway can report. */
            <Skeleton className="h-24 rounded-xl" />
          ) : devices.length === 0 ? (
            <Stack gap={1}>
              <Text token="body-medium" role="status">
                No computers are paired with your Lovelace account yet.
              </Text>
              <Text token="body-small" tone="muted">
                Install Lattice on the computer you want Athena to use, then refresh this list.
              </Text>
            </Stack>
          ) : (
            <ul className="flex flex-col">
              {devices.map((device) => (
                <li key={device.id} className="flex min-h-12 items-center gap-3 px-1">
                  <span aria-hidden className="text-on-surface-variant [&_svg]:size-4.5!">
                    {deviceIcon(device.status)}
                  </span>
                  <Stack gap={0} className="min-w-0 flex-1">
                    <Text token="body-medium" truncate>
                      {device.name}
                    </Text>
                    <Text token="body-small" tone="muted">
                      {LATTICE_DEVICE_STATUS_COPY[device.status]}
                    </Text>
                  </Stack>
                  {device.selected ? (
                    <Chip variant="assist" icon={<CheckCircle2 />} selected asChild>
                      <span>In use</span>
                    </Chip>
                  ) : (
                    <Button
                      variant="outline"
                      onClick={() => {
                        chooseDevice.mutate(device.id);
                      }}
                      disabled={chooseDevice.isPending || device.status === 'revoked'}
                    >
                      Use this
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}

          {runningHere ? (
            <Text token="body-small" tone="muted">
              Athena&apos;s replies are generated on {status.deviceName ?? 'your computer'}. If it
              is unavailable, Athena tells you instead of quietly using a cloud model.
            </Text>
          ) : status.enabled && status.deviceId ? (
            <Text token="body-small" tone="muted">
              Athena will use {status.deviceName ?? 'your computer'} as soon as it is reachable. It
              will not fall back to a cloud model in the meantime.
            </Text>
          ) : (
            <Text token="body-small" tone="muted">
              Athena is using Docket&apos;s standard model service right now.
            </Text>
          )}
        </Stack>
      ) : (
        <Stack gap={2}>
          <Text token="body-medium">
            You&apos;ll approve this on Lovelace&apos;s own sign-in page. Docket never sees your
            Lovelace password.
          </Text>
          <ControlGroup wrap>
            {status.scopes.map((scope) => (
              <Chip key={scope} variant="suggestion" leadingNone="md3-suggestion-chip" asChild>
                <span>{scope}</span>
              </Chip>
            ))}
          </ControlGroup>
          <Text token="body-small" tone="muted">
            Those are the only permissions Athena asks for: run model work, and read the list of
            your computers. It cannot add or remove computers on your account.
          </Text>
        </Stack>
      )}

      {reason ? <ReasonNote reason={reason} /> : null}

      {actionError ? <LoadFailure message={actionError} /> : null}

      <Text token="body-small" tone="muted" role="status" aria-live="polite">
        {authorize.isPending
          ? 'Opening Lovelace…'
          : chooseDevice.isPending
            ? 'Switching computers…'
            : setEnabled.isPending || disconnect.isPending
              ? 'Saving…'
              : ''}
      </Text>
    </SettingsGroup>
  );
}
