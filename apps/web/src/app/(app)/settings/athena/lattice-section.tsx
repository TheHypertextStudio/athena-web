'use client';

/**
 * `settings/athena` — run models on your own computer via Lovelace Lattice.
 *
 * @remarks
 * Turnkey in three clicks: connect, approve on Lovelace, pick a computer. No URL, key, or token
 * field anywhere in this section.
 */
import { CheckCircle2, CircleDashed, CloudOff, Computer, XCircle } from '@docket/ui/icons';
import { ConfirmDestructiveDialog, EmptyState } from '@docket/ui/components';
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
import { type JSX, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';
import { LoadFailure } from '@/components/settings/load-failure';
import { firstWriteError, WriteError } from '@/components/settings/write-error';
import { SettingsGroup } from '@/components/settings/settings-group';
import { SettingRow } from '@/components/settings/setting-row';
import { SETTINGS_NODES } from '@/components/settings/settings-capabilities';
import { UserFacingError, userErrorMessage } from '@/lib/problem';
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
  LATTICE_SETUP_URL,
  LATTICE_UNAVAILABLE_REASON_MESSAGE,
  type LatticeAuthorizationOutcome,
  type LatticeDeploymentReason,
  type LatticeUnavailableReason,
} from './lattice-copy';
import {
  requestLatticeFedCM,
  type LatticeAuthorizationStart,
  type LatticeFedCMResult,
} from './lattice-fedcm';

/** The device states the API reports. */
type DeviceStatus = 'unpaired' | 'reachable' | 'offline' | 'revoked';

/** The two ceremony-in-flight labels shared by the connected and unconnected live regions. */
const OPENING_LOVELACE = 'Opening Lovelace…';
const PREPARING_LOVELACE = 'Preparing Lovelace…';

/** Message for each ceremony outcome that didn't connect. */
const CEREMONY_ISSUE_MESSAGE: Readonly<
  Record<Exclude<LatticeAuthorizationOutcome, 'connected'>, string>
> = {
  declined: 'You declined the connection.',
  scopes: 'Approve all the permissions Athena asks for.',
  error: 'That connection attempt failed.',
};

/** Whether the OAuth callback's `lattice` URL flag is one of the outcomes this section knows how to say. */
function isLatticeAuthorizationOutcome(value: string | null): value is LatticeAuthorizationOutcome {
  return value !== null && (value === 'connected' || Object.hasOwn(CEREMONY_ISSUE_MESSAGE, value));
}

/** Message for a ceremony that didn't connect. */
function ceremonyIssueMessage(outcome: Exclude<LatticeAuthorizationOutcome, 'connected'>): string {
  return CEREMONY_ISSUE_MESSAGE[outcome];
}

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

/**
 * The redirect transport, offered as a deliberate second click after an invoked FedCM dialog.
 *
 * @remarks
 * Rendered as one flat band — heading, sentence, single filled action — never a second button
 * beside the one that just failed.
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
  /** `prepareGeneration` at the moment this ceremony started, so a stale resolution is ignored. */
  readonly generation: number;
}

/**
 * Own the native-first ceremony and its explicit redirect-fallback state.
 *
 * @param enabled - Whether a server attempt should be prepared eagerly.
 * @param onCompleted - Called synchronously inside the completion mutation's `onSuccess`, before
 * this hook's own state commits, so a caller patching other state (e.g. the connection query's
 * cache) does it in the same render as the outcome rather than a `useEffect` later.
 */
function useLatticeAuthorization(
  enabled: boolean,
  onCompleted?: (outcome: LatticeAuthorizationOutcome) => void,
): {
  readonly authorize: ReturnType<
    typeof useApiMutation<AuthorizationAction, PendingAuthorizationCeremony>
  >;
  readonly prepare: ReturnType<typeof useApiMutation<LatticeAuthorizationStart, number>>;
  readonly authorizationReady: boolean;
  readonly fallbackUrl: string | null;
  readonly resetAuthorization: () => void;
  readonly startAuthorization: () => void;
} {
  const [started, setStarted] = useState<LatticeAuthorizationStart | null>(null);
  const [fallbackUrl, setFallbackUrl] = useState<string | null>(null);
  const prepareGeneration = useRef(0);

  const prepare = useApiMutation<LatticeAuthorizationStart, number>({
    mutationFn: () =>
      unwrap(
        () => api.v1.me.athena.lattice.authorize.$post(),
        'Could not start the Lovelace connection.',
      ),
    onSuccess: (authorization, generation) => {
      if (generation === prepareGeneration.current) setStarted(authorization);
    },
  });

  useEffect(() => {
    if (!enabled || started || prepare.isPending || prepare.isError) return;
    prepare.mutate(prepareGeneration.current);
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
    onSuccess: (data, { generation }) => {
      // A disconnect that landed while this ceremony was in flight already reset the hook for a
      // fresh attempt; applying a stale ceremony's outcome now would resurrect state (including a
      // `connected: true` cache write) the person has since explicitly undone.
      if (generation !== prepareGeneration.current) return;
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
      onCompleted?.(data.status);
    },
    invalidateKeys: [queryKeys.latticeConnection(), queryKeys.latticeDevices()],
  });

  return {
    authorize,
    prepare,
    authorizationReady: started !== null,
    fallbackUrl,
    resetAuthorization: () => {
      prepareGeneration.current += 1;
      prepare.reset();
      authorize.reset();
      setStarted(null);
      setFallbackUrl(null);
    },
    startAuthorization: () => {
      if (!started) return;
      setFallbackUrl(null);
      // Active-mode FedCM requires transient user activation. Calling the browser boundary here,
      // before React Query or another network round trip, keeps it on the original click stack.
      const result = requestLatticeFedCM(started);
      authorize.mutate({ started, result, generation: prepareGeneration.current });
    },
  };
}

/** The unconnected branch's own live-region status line. */
function unconnectedStatusCopy(authorizePending: boolean, authorizationReady: boolean): string {
  if (authorizePending) return OPENING_LOVELACE;
  if (authorizationReady) return '';
  return PREPARING_LOVELACE;
}

/** Render the connect ceremony before an approved Lovelace grant exists. */
function UnconnectedLatticeSection({
  actionError,
  authorizePending,
  authorizationReady,
  fallbackUrl,
  startAuthorization,
}: {
  readonly actionError: string | null;
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
            {authorizePending ? 'Connecting…' : 'Connect'}
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
        {unconnectedStatusCopy(authorizePending, authorizationReady)}
      </Text>
    </SettingsGroup>
  );
}

/** The one field every Lattice write response shares: the reason it silently refused, if any. */
interface LatticeRefusableResult {
  readonly unavailableReason: LatticeUnavailableReason | null;
}

/** Throw a reason-specific message when a write's 200 response is actually a refusal. */
function requireLatticeSuccess<T extends LatticeRefusableResult>(result: T): T {
  if (result.unavailableReason) {
    throw new UserFacingError(LATTICE_UNAVAILABLE_REASON_MESSAGE[result.unavailableReason]);
  }
  return result;
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
  if (state.preparingAuthorization) return PREPARING_LOVELACE;
  if (state.authorizing) return OPENING_LOVELACE;
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
  // Seeded once from the redirect-return URL flag (the full-page OAuth transport has no other way
  // to report a non-connected outcome, since the component remounts from scratch). Also set from
  // the in-page FedCM ceremony below. Cleared the moment a new attempt starts.
  const [ceremonyIssue, setCeremonyIssue] = useState<string | null>(() =>
    isLatticeAuthorizationOutcome(returned) && returned !== 'connected'
      ? ceremonyIssueMessage(returned)
      : null,
  );
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
    authorizationReady,
    fallbackUrl,
    resetAuthorization,
    startAuthorization,
  } = useLatticeAuthorization(status?.available === true, (outcome) => {
    if (outcome !== 'connected') {
      setCeremonyIssue(ceremonyIssueMessage(outcome));
      return;
    }
    // The invalidated refetch below will land moments later with the authoritative row
    // (device, enabled, etc.); this only needs to flip `connected` in the same tick so the
    // section never paints the unconnected branch a moment after the ceremony succeeded.
    // `unavailableReason` is cleared too: a standing auth-related reason (the only kind that
    // requires reconnecting to begin with) cannot still be true immediately after Lovelace just
    // approved a fresh grant.
    queryClient.setQueryData(latticeConnectionDef.queryKey, (prev) =>
      prev ? { ...prev, connected: true, unavailableReason: null } : prev,
    );
  });
  const handleStartAuthorization = (): void => {
    setCeremonyIssue(null);
    startAuthorization();
  };

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

  // The device list succeeding is proof the gateway (and the grant behind it) is reachable right
  // now — a live signal fresher than whatever standing reason the connection status query still
  // has cached from before. Without this, a recovered account can sit with the Reconnect button
  // weighted urgent until something else happens to refetch the status query.
  useEffect(() => {
    if (devicesQ.data?.unavailableReason !== null) return;
    queryClient.setQueryData(latticeConnectionDef.queryKey, (prev) =>
      prev && prev.unavailableReason !== null ? { ...prev, unavailableReason: null } : prev,
    );
  }, [devicesQ.data, queryClient, latticeConnectionDef.queryKey]);

  const chooseDevice = useApiMutation<unknown, string>({
    mutationFn: async (deviceId) => {
      const result = await unwrap(
        () => api.v1.me.athena.lattice.device.$post({ json: { deviceId } }),
        'Could not switch Athena to that computer.',
      );
      // A 200 can still be a refusal (e.g. the device is no longer on the account, or the gateway
      // itself was unreachable) — treat it as a failure so it surfaces the same way a rejected
      // request would, with the reason that actually caused it.
      return requireLatticeSuccess(result);
    },
    onSuccess: () => {
      setCeremonyIssue(null);
    },
    invalidateKeys: [queryKeys.latticeConnection(), queryKeys.latticeDevices()],
  });

  const setEnabled = useApiMutation<unknown, boolean>({
    mutationFn: async (enabled) => {
      const result = await unwrap(
        () => api.v1.me.athena.lattice.$patch({ json: { enabled } }),
        'Could not change where Athena runs.',
      );
      return requireLatticeSuccess(result);
    },
    onSuccess: () => {
      setCeremonyIssue(null);
    },
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
  const actionError =
    firstWriteError([
      [prepare, 'Could not prepare the Lovelace connection.'],
      [authorize, 'Could not start the Lovelace connection.'],
      [chooseDevice, 'Could not switch Athena to that computer.'],
      [setEnabled, 'Could not change where Athena runs.'],
    ]) ?? ceremonyIssue;
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
  // list only becomes meaningful once a grant exists.
  if (!connected) {
    return (
      <UnconnectedLatticeSection
        actionError={actionError}
        authorizePending={prepare.isPending || authorize.isPending}
        authorizationReady={authorizationReady}
        fallbackUrl={fallbackUrl}
        startAuthorization={handleStartAuthorization}
      />
    );
  }

  const devices = devicesQ.data?.devices ?? [];
  // Only an account-level reason actually gets fixed by reconnecting — a device being asleep,
  // disabled, or gone from the account never is, so the button's weight stays scoped to what it
  // can fix. The device row's own status word carries the device-level signal instead.
  const needsReconnect = status.unavailableReason !== null;

  return (
    <>
      <SettingsGroup
        capability={SETTINGS_NODES.athenaLattice}
        body="rows"
        action={
          <ControlGroup>
            <Button
              variant={needsReconnect ? 'secondary' : 'ghost'}
              onClick={handleStartAuthorization}
              disabled={prepare.isPending || authorize.isPending || !authorizationReady}
            >
              Reconnect
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
        {fallbackUrl ? <AuthorizationFallback authorizationUrl={fallbackUrl} /> : null}

        {devicesQ.isPending ? (
          /* placeholder: the list of computers paired to this person's Lovelace account, which
               only the gateway can report. */
          <div className="px-4 pb-4">
            <Skeleton className="h-24 rounded-xl" />
          </div>
        ) : devices.length === 0 ? (
          // EmptyState itself carries no live-region role (most of its 13+ other callers render
          // on first paint, where one would just announce the initial page); this transition can
          // happen live (a person's last device drops off mid-session), so it's added locally.
          <div role="status">
            {devicesQ.isError || devicesQ.data.unavailableReason ? (
              <EmptyState
                icon={Computer}
                title="Could not load your computers"
                body="Try again in a moment, or reconnect Lovelace if this keeps happening."
                frame="none"
              />
            ) : (
              <EmptyState
                icon={Computer}
                title="No computers paired"
                body="Install Lattice on a computer to pair it here."
                frame="none"
                action={
                  <Button asChild variant="outline">
                    <a href={LATTICE_SETUP_URL} target="_blank" rel="noopener noreferrer">
                      Set up Lattice
                    </a>
                  </Button>
                }
              />
            )}
          </div>
        ) : (
          <ul className="flex flex-col" aria-live="polite" aria-atomic="false">
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
        description="Athena falls back to Docket's standard models — you'll pick a computer again next time. Lovelace still shows Docket as authorized, so revoke it there too if you want a clean break."
        confirmLabel="Disconnect"
        pending={disconnect.isPending}
        {...(disconnect.isError
          ? { error: userErrorMessage(disconnect.error, 'Could not disconnect Lovelace.') }
          : {})}
        onConfirm={() => {
          disconnect.mutate(undefined, {
            onSuccess: () => {
              // Disconnect deletes all server-side authorization attempts. Discard the eagerly
              // prepared reconnect attempt too so an immediate reconnect cannot reuse a dead ID.
              resetAuthorization();
              setCeremonyIssue(null);
              setConfirmDisconnect(false);
            },
          });
        }}
      />
    </>
  );
}
