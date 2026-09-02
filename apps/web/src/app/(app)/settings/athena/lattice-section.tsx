'use client';

/**
 * `settings/athena` — run models on your own computer.
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
import {
  CheckCircle2,
  CircleDashed,
  CloudOff,
  Computer,
  RefreshCw,
  XCircle,
} from '@docket/ui/icons';
import {
  Button,
  Chip,
  ControlGroup,
  DecorativeIcon,
  Skeleton,
  Stack,
  Text,
  Toolbar,
} from '@docket/ui/primitives';
import { useAppSearchParams } from '@/lib/app-location';
import { type JSX, type ReactNode, useEffect, useState } from 'react';

import { api } from '@/lib/api';
import { LoadFailure } from '@/components/settings/load-failure';
import { firstWriteError } from '@/components/settings/write-error';
import { SettingsGroup } from '@/components/settings/settings-group';
import { SettingRow } from '@/components/settings/setting-row';
import { SETTINGS_NODES } from '@/components/settings/settings-capabilities';
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
  LATTICE_FEDCM_FALLBACK_COPY,
  LATTICE_REASON_COPY,
  LATTICE_RETURN_COPY,
  type LatticeDeploymentReason,
  type LatticeReason,
} from './lattice-copy';
import {
  requestLatticeFedCM,
  type LatticeAuthorizationStart,
  type LatticeFedCMResult,
} from './lattice-fedcm';

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

/** The redirect transport remains a deliberate second click after an invoked FedCM dialog. */
function AuthorizationFallback({
  authorizationUrl,
}: {
  readonly authorizationUrl: string;
}): JSX.Element {
  return (
    <Stack gap={2} className="px-4 pb-4" role="status">
      <Text token="body-small" tone="muted">
        {LATTICE_FEDCM_FALLBACK_COPY}
      </Text>
      <div>
        <Button
          variant="outline"
          onClick={() => {
            window.location.assign(authorizationUrl);
          }}
        >
          Continue in Lovelace
        </Button>
      </div>
    </Stack>
  );
}

/** A native-code completion result in addition to the transport helper's three outcomes. */
type AuthorizationAction =
  | Exclude<LatticeFedCMResult, { readonly kind: 'code' }>
  | { readonly kind: 'completed'; readonly status: 'connected' | 'declined' | 'error' | 'scopes' };

/** A browser ceremony started directly by the click, paired with its pre-created server attempt. */
interface PendingAuthorizationCeremony {
  readonly started: LatticeAuthorizationStart;
  readonly result: Promise<LatticeFedCMResult>;
}

/** Own the native-first ceremony and its explicit redirect-fallback state. */
function useLatticeAuthorization(enabled: boolean): {
  readonly authorize: ReturnType<
    typeof useApiMutation<AuthorizationAction, PendingAuthorizationCeremony>
  >;
  readonly prepare: ReturnType<typeof useApiMutation<LatticeAuthorizationStart, undefined>>;
  readonly authorizationNotice: string | null;
  readonly authorizationReady: boolean;
  readonly fallbackUrl: string | null;
  readonly startAuthorization: () => void;
} {
  const [started, setStarted] = useState<LatticeAuthorizationStart | null>(null);
  const [fallbackUrl, setFallbackUrl] = useState<string | null>(null);
  const [authorizationNotice, setAuthorizationNotice] = useState<string | null>(null);

  const prepare = useApiMutation<LatticeAuthorizationStart, undefined>({
    mutationFn: () =>
      unwrap(
        () => api.v1.me.athena.lattice.authorize.$post(),
        'Could not start the Lovelace connection.',
      ),
    onSuccess: setStarted,
  });

  useEffect(() => {
    if (!enabled || started || prepare.isPending || prepare.isError) return;
    prepare.mutate(undefined);
  }, [enabled, prepare.isError, prepare.isPending, prepare.mutate, started]);

  const authorize = useApiMutation<AuthorizationAction, PendingAuthorizationCeremony>({
    mutationFn: async ({ started: prepared, result }) => {
      const fedcm = await result;
      if (fedcm.kind !== 'code') return fedcm;
      const completed = await unwrap(
        () =>
          api.v1.me.athena.lattice.authorize.complete.$post({
            json: {
              attemptId: prepared.attemptId,
              authorizationCode: fedcm.authorizationCode,
            },
          }),
        'Could not finish the Lovelace connection.',
      );
      return { kind: 'completed', status: completed.status };
    },
    onSuccess: (data) => {
      setFallbackUrl(null);
      if (data.kind === 'redirect') {
        window.location.assign(data.authorizationUrl);
        return;
      }
      if (data.kind === 'fallback') {
        setFallbackUrl(data.authorizationUrl);
        return;
      }
      // Authorization attempts are single-use. Prepare a fresh one for a later reconnect instead
      // of retaining the completed PKCE state in this mounted settings section.
      setStarted(null);
      setAuthorizationNotice(LATTICE_RETURN_COPY[data.status] ?? null);
    },
    invalidateKeys: [queryKeys.latticeConnection(), queryKeys.latticeDevices()],
  });

  return {
    authorize,
    prepare,
    authorizationNotice,
    authorizationReady: started !== null,
    fallbackUrl,
    startAuthorization: () => {
      if (!started) return;
      setFallbackUrl(null);
      setAuthorizationNotice(null);
      // Active-mode FedCM requires transient user activation. Calling the browser boundary here,
      // before React Query or another network round trip, keeps it on the original click stack.
      const result = requestLatticeFedCM(started);
      authorize.mutate({ started, result });
    },
  };
}

/** Render the connect ceremony before an approved Lovelace grant exists. */
function UnconnectedLatticeSection({
  actionError,
  authorizationNotice,
  authorizePending,
  authorizationReady,
  fallbackUrl,
  startAuthorization,
}: {
  readonly actionError: string | null;
  readonly authorizationNotice: string | null;
  readonly authorizePending: boolean;
  readonly authorizationReady: boolean;
  readonly fallbackUrl: string | null;
  readonly startAuthorization: () => void;
}): JSX.Element {
  return (
    <SettingsGroup capability={SETTINGS_NODES.athenaLattice} body="rows">
      <SettingRow
        leading={<DecorativeIcon icon={Computer} />}
        label="Lattice"
        description="Run Athena's models on a computer you own, instead of the model service Docket runs."
        trailing={
          <Button
            controlSize="md"
            variant="outline"
            disabled={authorizePending || !authorizationReady}
            onClick={startAuthorization}
          >
            {authorizePending ? 'Connecting…' : 'Connect with Lovelace'}
          </Button>
        }
      />
      {authorizationNotice ? (
        <Text token="body-medium" role="status" className="px-4 pb-4">
          {authorizationNotice}
        </Text>
      ) : null}
      {fallbackUrl ? <AuthorizationFallback authorizationUrl={fallbackUrl} /> : null}
      {actionError ? (
        <div className="px-4 pb-4">
          <LoadFailure message={actionError} />
        </div>
      ) : null}
      <Text token="body-small" tone="muted" role="status" aria-live="polite" className="px-4">
        {authorizePending ? 'Opening Lovelace…' : authorizationReady ? '' : 'Preparing Lovelace…'}
      </Text>
    </SettingsGroup>
  );
}

interface LatticePendingActionState {
  readonly preparingAuthorization: boolean;
  readonly authorizing: boolean;
  readonly choosingDevice: boolean;
  readonly settingEnabled: boolean;
  readonly disconnecting: boolean;
}

/** Return the one operation label shown in the section's polite live region. */
function pendingActionCopy(state: LatticePendingActionState): string {
  if (state.preparingAuthorization) return 'Preparing Lovelace…';
  if (state.authorizing) return 'Opening Lovelace…';
  if (state.choosingDevice) return 'Switching computers…';
  if (state.settingEnabled || state.disconnecting) return 'Saving…';
  return '';
}

/**
 * Settings → Athena → run models on your own computer.
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
  const {
    authorize,
    prepare,
    authorizationNotice,
    authorizationReady,
    fallbackUrl,
    startAuthorization,
  } = useLatticeAuthorization(status?.available === true);

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
  const actionError = firstWriteError([
    [prepare, 'Could not prepare the Lovelace connection.'],
    [authorize, 'Could not start the Lovelace connection.'],
    [chooseDevice, 'Could not switch Athena to that computer.'],
    [setEnabled, 'Could not change where Athena runs.'],
    [disconnect, 'Could not disconnect Lovelace.'],
  ]);
  const actionStatus = pendingActionCopy({
    preparingAuthorization: prepare.isPending,
    authorizing: authorize.isPending,
    choosingDevice: chooseDevice.isPending,
    settingEnabled: setEnabled.isPending,
    disconnecting: disconnect.isPending,
  });

  if (statusQ.isPending) {
    return (
      // placeholder: whether this person has authorized Lovelace and which of their computers is
      // chosen — both are per-account facts only the stored record knows.
      <SettingsGroup capability={SETTINGS_NODES.athenaLattice}>
        <Skeleton className="h-40 rounded-xl" />
      </SettingsGroup>
    );
  }

  if (statusQ.isError || !status) {
    return (
      <SettingsGroup capability={SETTINGS_NODES.athenaLattice}>
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
      <SettingsGroup capability={SETTINGS_NODES.athenaLattice}>
        <Text token="body-medium" tone="muted" role="status">
          {LATTICE_DEPLOYMENT_COPY[reason]}
        </Text>
      </SettingsGroup>
    );
  }

  // Before anyone has connected, this is an integration like any other: one row naming the
  // service, a sentence on what it gives you, and the single action that starts it. The device
  // list and its states only become meaningful once a grant exists.
  if (!connected) {
    return (
      <UnconnectedLatticeSection
        actionError={actionError}
        authorizationNotice={authorizationNotice}
        authorizePending={prepare.isPending || authorize.isPending}
        authorizationReady={authorizationReady}
        fallbackUrl={fallbackUrl}
        startAuthorization={startAuthorization}
      />
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
    listReason ?? chosenReason ?? statusReason ?? (status.deviceId ? null : 'no_device_selected');
  const runningHere = status.enabled && status.deviceId !== null && chosenReason === null;
  // The return flag lives in the URL and survives every later interaction, so it is suppressed
  // once its instruction has been carried out — telling someone to "choose a computer" under a
  // list where they already did reads as a broken screen.
  const returnNote =
    authorizationNotice ??
    (returned && !(returned === 'connected' && status.deviceId)
      ? LATTICE_RETURN_COPY[returned]
      : undefined);

  return (
    <SettingsGroup
      capability={SETTINGS_NODES.athenaLattice}
      action={
        <ControlGroup>
          <Button
            variant="ghost"
            onClick={startAuthorization}
            disabled={prepare.isPending || authorize.isPending || !authorizationReady}
          >
            Reconnect Lovelace
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              disconnect.mutate(undefined);
            }}
            disabled={disconnect.isPending}
          >
            Disconnect
          </Button>
        </ControlGroup>
      }
    >
      {returnNote ? (
        <Text token="body-medium" role="status">
          {returnNote}
        </Text>
      ) : null}

      {fallbackUrl ? <AuthorizationFallback authorizationUrl={fallbackUrl} /> : null}

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
          <Stack gap={1} role="status">
            <Text token="body-medium">No computers are paired yet</Text>
            <Text token="body-small" tone="muted">
              Install Lattice on the computer you want Athena to use. It appears here once it
              connects — use Refresh above if you have just installed it.
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
            Athena&apos;s replies are generated on {status.deviceName ?? 'your computer'}. If it is
            unavailable, Athena tells you instead of quietly using a cloud model.
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

      {reason ? <ReasonNote reason={reason} /> : null}

      {actionError ? <LoadFailure message={actionError} /> : null}

      <Text token="body-small" tone="muted" role="status" aria-live="polite">
        {actionStatus}
      </Text>
    </SettingsGroup>
  );
}
