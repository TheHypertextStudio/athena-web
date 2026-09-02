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
import { CheckCircle2, CircleDashed, CloudOff, Computer, XCircle } from '@docket/ui/icons';
import { ConfirmDestructiveDialog } from '@docket/ui/components';
import {
  Button,
  Chip,
  ControlGroup,
  DecorativeIcon,
  Row,
  Skeleton,
  Stack,
  Text,
} from '@docket/ui/primitives';
import { useAppSearchParams } from '@/lib/app-location';
import { type JSX, useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';
import { LoadFailure } from '@/components/settings/load-failure';
import { firstWriteError, WriteError } from '@/components/settings/write-error';
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
  type LatticeAuthorizationOutcome,
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

/** The leading glyph for one device state, plus the tone to frame it in when that state is worth calling out. */
function deviceIcon(status: DeviceStatus): typeof CheckCircle2 {
  switch (status) {
    case 'reachable':
      return CheckCircle2;
    case 'offline':
      return CloudOff;
    case 'unpaired':
      return CircleDashed;
    case 'revoked':
      return XCircle;
  }
}

/** Retint a device row's icon frame for the states worth a tonal call-out; ready/asleep stay neutral. */
const DEVICE_ICON_TONE: Readonly<Record<DeviceStatus, string>> = {
  reachable: '',
  offline: '',
  unpaired: '',
  revoked: 'bg-error/12 text-error',
};

/** Whether the OAuth callback's `lattice` URL flag is one of the outcomes this section knows how to say. */
function isLatticeAuthorizationOutcome(value: string | null): value is LatticeAuthorizationOutcome {
  return value === 'connected' || value === 'declined' || value === 'error' || value === 'scopes';
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
 * The redirect transport, offered as a deliberate second click after an invoked FedCM dialog.
 *
 * @remarks
 * Never rendered as a loose line of muted text beside the button that just failed: two
 * same-weight buttons in one card read as two ways to do the same thing, and a muted sentence
 * reads as an aside rather than as the way forward. The offer is one flat band — a heading, a
 * sentence describing what the click does, and a single filled action — at the group's own tonal
 * step, not a second nested card floating inside the group's own `Surface`.
 *
 * @param props - The redirect target for this attempt.
 * @param props.authorizationUrl - Lovelace's authorization URL for the pending attempt.
 * @returns The flat fallback band.
 */
function AuthorizationFallback({
  authorizationUrl,
}: {
  readonly authorizationUrl: string;
}): JSX.Element {
  return (
    <div className="bg-surface-container px-4 py-3" role="status">
      <Stack gap={3}>
        <Stack gap={1}>
          <Text token="title-small">{LATTICE_FEDCM_FALLBACK_COPY.title}</Text>
          <Text token="body-small" tone="muted">
            {LATTICE_FEDCM_FALLBACK_COPY.body}
          </Text>
        </Stack>
        <Row>
          <Button
            onClick={() => {
              window.location.assign(authorizationUrl);
            }}
          >
            {LATTICE_FEDCM_FALLBACK_COPY.action}
          </Button>
        </Row>
      </Stack>
    </div>
  );
}

/** A native-code completion result in addition to the transport helper's three outcomes. */
type AuthorizationAction =
  | Exclude<LatticeFedCMResult, { readonly kind: 'code' }>
  | { readonly kind: 'completed'; readonly status: LatticeAuthorizationOutcome };

/** A browser ceremony started directly by the click, paired with its pre-created server attempt. */
interface PendingAuthorizationCeremony {
  readonly started: LatticeAuthorizationStart;
  readonly result: Promise<LatticeFedCMResult>;
}

/**
 * Own the native-first ceremony and its explicit redirect-fallback state.
 *
 * @param enabled - Whether a server attempt should be prepared eagerly.
 * @param onCompleted - Called synchronously, inside the completion mutation's own `onSuccess`,
 * the instant an outcome is known — before this hook's own state commits. A caller that needs to
 * patch other state (e.g. the connection query's cache) in the same render as the outcome must do
 * it here; reacting to the returned `authorizationOutcome` from a `useEffect` one render later
 * reopens the same kind of race this hook exists to close.
 */
function useLatticeAuthorization(
  enabled: boolean,
  onCompleted?: (outcome: LatticeAuthorizationOutcome) => void,
): {
  readonly authorize: ReturnType<
    typeof useApiMutation<AuthorizationAction, PendingAuthorizationCeremony>
  >;
  readonly prepare: ReturnType<typeof useApiMutation<LatticeAuthorizationStart, undefined>>;
  readonly authorizationOutcome: LatticeAuthorizationOutcome | null;
  readonly authorizationReady: boolean;
  readonly fallbackUrl: string | null;
  readonly startAuthorization: () => void;
} {
  const [started, setStarted] = useState<LatticeAuthorizationStart | null>(null);
  const [fallbackUrl, setFallbackUrl] = useState<string | null>(null);
  const [authorizationOutcome, setAuthorizationOutcome] =
    useState<LatticeAuthorizationOutcome | null>(null);

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
          api.v1.me.athena.lattice.authorize.code.$post({
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
      setAuthorizationOutcome(data.status);
      onCompleted?.(data.status);
    },
    invalidateKeys: [queryKeys.latticeConnection(), queryKeys.latticeDevices()],
  });

  return {
    authorize,
    prepare,
    authorizationOutcome,
    authorizationReady: started !== null,
    fallbackUrl,
    startAuthorization: () => {
      if (!started) return;
      setFallbackUrl(null);
      setAuthorizationOutcome(null);
      // Active-mode FedCM requires transient user activation. Calling the browser boundary here,
      // before React Query or another network round trip, keeps it on the original click stack.
      const result = requestLatticeFedCM(started);
      authorize.mutate({ started, result });
    },
  };
}

/**
 * The one "you just did something" line for this card. Tone follows what's actually true:
 * `connected` is good news; `declined` changed nothing, so it stays quiet; `scopes`/`error` leave
 * Athena unable to use Lovelace, which is worth an alert. Same rendering regardless of which
 * branch of the section is showing, at the same position (first), so the two branches never
 * disagree about where or how this reads.
 */
function LatticeNotice({
  outcome,
}: {
  readonly outcome: LatticeAuthorizationOutcome | null;
}): JSX.Element | null {
  if (!outcome) return null;
  const text = LATTICE_RETURN_COPY[outcome];
  switch (outcome) {
    case 'connected':
      return (
        <Text token="body-medium" role="status" className="text-primary px-4 pb-3">
          {text}
        </Text>
      );
    case 'declined':
      return (
        <Text token="body-medium" tone="muted" role="status" className="px-4 pb-3">
          {text}
        </Text>
      );
    case 'scopes':
    case 'error':
      return (
        <Text token="body-medium" role="alert" className="text-error px-4 pb-3">
          {text}
        </Text>
      );
  }
}

/** Render the connect ceremony before an approved Lovelace grant exists. */
function UnconnectedLatticeSection({
  actionError,
  notice,
  authorizePending,
  authorizationReady,
  fallbackUrl,
  startAuthorization,
}: {
  readonly actionError: string | null;
  readonly notice: LatticeAuthorizationOutcome | null;
  readonly authorizePending: boolean;
  readonly authorizationReady: boolean;
  readonly fallbackUrl: string | null;
  readonly startAuthorization: () => void;
}): JSX.Element {
  return (
    <SettingsGroup capability={SETTINGS_NODES.athenaLattice} body="rows">
      <LatticeNotice outcome={notice} />
      <SettingRow
        leading={<DecorativeIcon icon={Computer} />}
        label="Lattice"
        description="Run Athena's models on a computer you own."
        trailing={
          <Button
            controlSize="md"
            // Once the fallback is offered it becomes the action that will
            // actually work, so this one steps back rather than competing with
            // it as a second equally-weighted button.
            variant={fallbackUrl ? 'ghost' : 'outline'}
            disabled={authorizePending || !authorizationReady}
            onClick={startAuthorization}
          >
            {authorizePending ? 'Connecting…' : 'Connect with Lovelace'}
          </Button>
        }
      />
      {fallbackUrl ? <AuthorizationFallback authorizationUrl={fallbackUrl} /> : null}
      {actionError ? (
        <div className="px-4 pb-4">
          <WriteError message={actionError} />
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
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const queryClient = useQueryClient();
  // Named so its `.queryKey` can be reused for a direct cache write below — the definition, not
  // just the key, is what keeps the write type-checked against what this read returns.
  const latticeConnectionDef = apiQueryOptions(
    queryKeys.latticeConnection(),
    () => api.v1.me.athena.lattice.$get(),
    'Could not load your Lattice connection.',
    { staleTime: STALE.volatile },
  );
  const statusQ = useApiQuery(latticeConnectionDef);
  const status = statusQ.data ?? null;
  const connected = status?.connected ?? false;
  const {
    authorize,
    prepare,
    authorizationOutcome,
    authorizationReady,
    fallbackUrl,
    startAuthorization,
  } = useLatticeAuthorization(status?.available === true, (outcome) => {
    if (outcome !== 'connected') return;
    // The invalidated refetch below will land moments later with the authoritative row (device,
    // enabled, etc.); this only needs to flip `connected` in the same tick as `authorizationOutcome`
    // committing, so the section never paints the unconnected branch beside a "connected" notice.
    queryClient.setQueryData(latticeConnectionDef.queryKey, (prev) =>
      prev ? { ...prev, connected: true } : prev,
    );
  });

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
  // driven by a single control) and separate lines would reserve space that's almost always
  // empty. Disconnect's failure surfaces inside its own confirmation dialog instead — it is
  // already the one place a person is looking when that write can fail.
  const actionError = firstWriteError([
    [prepare, 'Could not prepare the Lovelace connection.'],
    [authorize, 'Could not start the Lovelace connection.'],
    [chooseDevice, 'Could not switch Athena to that computer.'],
    [setEnabled, 'Could not change where Athena runs.'],
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

  // The outcome of a just-finished ceremony, whichever transport carried it: the FedCM hook's own
  // state when the browser stayed on this page, or the `lattice` URL flag when a redirect brought
  // it back. Suppressed once its instruction has plainly been carried out — a device already
  // chosen under "choose which computer" reads as a broken screen, not a stale one.
  const notice: LatticeAuthorizationOutcome | null =
    authorizationOutcome ??
    (isLatticeAuthorizationOutcome(returned) && !(returned === 'connected' && status.deviceId)
      ? returned
      : null);

  // Before anyone has connected, this is an integration like any other: one row naming the
  // service, a sentence on what it gives you, and the single action that starts it. The device
  // list and its states only become meaningful once a grant exists.
  if (!connected) {
    return (
      <UnconnectedLatticeSection
        actionError={actionError}
        notice={notice}
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

  return (
    <>
      <SettingsGroup
        capability={SETTINGS_NODES.athenaLattice}
        body="rows"
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
              variant="ghost-destructive"
              onClick={() => {
                setConfirmDisconnect(true);
              }}
              disabled={disconnect.isPending}
            >
              Disconnect
            </Button>
          </ControlGroup>
        }
      >
        <LatticeNotice outcome={notice} />

        {fallbackUrl ? <AuthorizationFallback authorizationUrl={fallbackUrl} /> : null}

        {devicesQ.isPending ? (
          /* placeholder: the list of computers paired to this person's Lovelace account, which
               only the gateway can report. */
          <div className="px-4 pb-4">
            <Skeleton className="h-24 rounded-xl" />
          </div>
        ) : devices.length === 0 ? (
          <Stack gap={1} role="status" className="px-4 pb-4">
            <Text token="body-medium">No computers are paired yet</Text>
            <Text token="body-small" tone="muted">
              Install Lattice on the computer you want Athena to use. It appears here once it
              connects.
            </Text>
          </Stack>
        ) : (
          <ul className="flex flex-col">
            {devices.map((device) => (
              <SettingRow
                key={device.id}
                as="li"
                leading={
                  <DecorativeIcon
                    icon={deviceIcon(device.status)}
                    className={DEVICE_ICON_TONE[device.status]}
                  />
                }
                label={device.name}
                description={LATTICE_DEVICE_STATUS_COPY[device.status]}
                trailing={
                  device.selected ? (
                    <ControlGroup>
                      <Chip variant="assist" icon={<CheckCircle2 />} selected asChild>
                        <span>In use</span>
                      </Chip>
                      <Button
                        variant={status.enabled ? 'secondary' : 'default'}
                        onClick={() => {
                          setEnabled.mutate(!status.enabled);
                        }}
                        disabled={setEnabled.isPending}
                      >
                        {status.enabled ? 'Turn off' : 'Turn on'}
                      </Button>
                    </ControlGroup>
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
                  )
                }
              />
            ))}
          </ul>
        )}

        {runningHere ? (
          <Text token="body-small" tone="muted" className="px-4">
            Athena answers only from {status.deviceName ?? 'your computer'} — if it&apos;s
            unavailable, you&apos;ll see that instead of a reply.
          </Text>
        ) : status.enabled && status.deviceId ? (
          <Text token="body-small" tone="muted" className="px-4">
            Athena will use {status.deviceName ?? 'your computer'} as soon as it is reachable. It
            will not fall back to a cloud model in the meantime.
          </Text>
        ) : (
          <Text token="body-small" tone="muted" className="px-4">
            Athena is using Docket&apos;s standard model service right now.
          </Text>
        )}

        {reason ? (
          <div className="px-4 pb-4">
            <ReasonNote reason={reason} />
          </div>
        ) : null}

        {actionError ? (
          <div className="px-4 pb-4">
            <WriteError message={actionError} />
          </div>
        ) : null}

        <Text token="body-small" tone="muted" role="status" aria-live="polite" className="px-4">
          {actionStatus}
        </Text>
      </SettingsGroup>

      <ConfirmDestructiveDialog
        open={confirmDisconnect}
        onOpenChange={setConfirmDisconnect}
        title="Disconnect Lovelace?"
        description="Athena falls back to Docket's standard model service, and you'll need to choose a computer again next time you connect."
        confirmLabel="Disconnect"
        pending={disconnect.isPending}
        {...(disconnect.isError
          ? { error: userErrorMessage(disconnect.error, 'Could not disconnect Lovelace.') }
          : {})}
        onConfirm={() => {
          disconnect.mutate(undefined, {
            onSuccess: () => {
              setConfirmDisconnect(false);
            },
          });
        }}
      />
    </>
  );
}
