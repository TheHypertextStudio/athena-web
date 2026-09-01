/**
 * `@docket/api` — owner-only Lattice routes (`/v1/me/athena/lattice`).
 *
 * @remarks
 * The surface a person uses to point Athena's model work at their own machine: see the state,
 * start the Lovelace consent flow, list their paired devices, pick one, turn it on, disconnect.
 *
 * Keyed only by the authenticated Better Auth user. A workspace never participates in this
 * authorization — the thing being authorized is someone's own hardware and their own Lovelace
 * account, so an org role could not meaningfully grant or deny it.
 *
 * ## Why a sleeping laptop is a 200, not a 409
 *
 * Every Lattice failure has an actionable cause: wake the machine, start the daemon, reconnect,
 * pick another device. Those are states of the connection, not faults in the request, so they come
 * back **in the payload** as a stable `unavailableReason` and the surface renders an instruction.
 * Modelling them as errors would force either an error toast for "your laptop is asleep" or a
 * widening of the closed {@link ProblemCode} taxonomy, and neither is right.
 *
 * Nothing here ever returns provider text; the copy for each reason lives in the web layer.
 *
 * @see `docs/engineering/specs/lattice-byo-model.md`
 */
import { db, latticeAuthorizationAttempt, latticeConnection, latticeCredential } from '@docket/db';
import {
  LATTICE_SCOPES,
  LATTICE_UNAVAILABLE_REASONS,
  LatticeUnavailableError,
  listLatticeDevices,
  type LatticeUnavailableReason,
} from '@docket/integrations';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import type { AppEnv } from '../context';
import { AuthError, ConflictError, NotFoundError } from '../error';
import { ok } from '../lib/ok';
import { apiDoc } from '../lib/openapi-route';
import { zJson } from '../lib/validate';
import {
  completeLatticeAuthorizationAttempt,
  startLatticeAuthorizationAttempt,
} from './lattice-authorization';
import {
  latticeConfigured,
  latticeGatewayContext,
  loadLatticeConnection,
  recordLatticeFailure,
  type LatticeConnectionRow,
} from './lattice-connection';

/** The live states the gateway reports for a paired device. */
const DeviceStatusEnum = z.enum(['unpaired', 'reachable', 'offline', 'revoked']);

/** Every actionable reason a Lattice operation can report, as a zod enum for the DTOs. */
const UnavailableReasonEnum = z.enum(
  LATTICE_UNAVAILABLE_REASONS as unknown as [
    LatticeUnavailableReason,
    ...LatticeUnavailableReason[],
  ],
);

/** Why this deployment cannot offer Lattice at all. */
const DeploymentReasonEnum = z.literal('not_configured');

/** Docket's view of one person's Lattice connection. */
const LatticeStatusOut = z
  .object({
    available: z.boolean().describe('Whether this deployment can offer Lattice at all right now.'),
    deploymentReason: DeploymentReasonEnum.nullable().describe(
      'Why the feature is unavailable: `not_configured` when no Lovelace OAuth client is registered. Null when available.',
    ),
    connected: z.boolean().describe('Whether an approved Lovelace grant is stored.'),
    enabled: z.boolean().describe('Whether Athena’s turns currently run on the connected device.'),
    deviceId: z.string().nullable().describe('The chosen device id; null when none is chosen.'),
    deviceName: z.string().nullable().describe('The chosen device’s name at selection time.'),
    deviceStatus: DeviceStatusEnum.nullable().describe(
      'The chosen device’s live state at the last gateway read.',
    ),
    scopes: z.array(z.string()).describe('The scopes Athena requests from Lovelace.'),
    grantedScope: z
      .string()
      .nullable()
      .describe('The scope string Lovelace granted, when it reported one.'),
    unavailableReason: UnavailableReasonEnum.nullable().describe(
      'Stable, actionable reason the connection cannot currently serve a turn; never provider text. Null when it can.',
    ),
  })
  .meta({ id: 'LatticeStatusOut', description: 'One person’s Lattice connection state.' });

/** One device the person has paired with their Lovelace account. */
const LatticeDeviceOut = z
  .object({
    id: z.string().describe('The gateway’s id for the device.'),
    name: z.string().describe('The name its owner gave it.'),
    status: DeviceStatusEnum.describe('Live reachability as of this read.'),
    ready: z.boolean().describe('Whether a turn dispatched right now could run on it.'),
    lastSeenAt: z.string().nullable().describe('ISO-8601 time the relay last saw it.'),
    executionBackend: z.string().describe('Which runtime family serves the work.'),
    selected: z.boolean().describe('Whether this is the device Athena is pointed at.'),
  })
  .meta({ id: 'LatticeDeviceOut', description: 'One paired Lattice device.' });

/** The device list, or the actionable reason it could not be read. */
const LatticeDeviceListOut = z
  .object({
    devices: z.array(LatticeDeviceOut).describe('Every device on the authorized account.'),
    unavailableReason: UnavailableReasonEnum.nullable().describe(
      'Why the list could not be read; null on success.',
    ),
  })
  .meta({ id: 'LatticeDeviceListOut', description: 'The user’s Lattice devices.' });

/** One OAuth request represented for redirect and native FedCM. */
const LatticeAuthorizeOut = z
  .object({
    authorizationUrl: z.string().describe('Lovelace’s consent screen for this authorization.'),
    attemptId: z.string().describe('Opaque one-use Docket authorization attempt id.'),
    expiresAt: z.string().describe('ISO-8601 expiry for this authorization attempt.'),
    fedcm: z
      .object({
        configUrl: z.string().describe('Lovelace’s FedCM provider configuration URL.'),
        clientId: z.string().describe('Docket’s registered public Lovelace client id.'),
        params: z
          .object({
            purpose: z.literal('oauth_authorization'),
            redirect_uri: z.string(),
            scope: z.string(),
            state: z.string(),
            code_challenge: z.string(),
            code_challenge_method: z.literal('S256'),
          })
          .describe('OAuth request values passed through FedCM’s Parameters API.'),
      })
      .describe('Inputs for an active native FedCM ceremony.'),
  })
  .meta({
    id: 'LatticeAuthorizeOut',
    description: 'One authorization attempt represented for redirect and native FedCM.',
  });

/** A one-time OAuth code returned by the browser's FedCM ceremony. */
const LatticeAuthorizeComplete = z
  .object({
    attemptId: z.string().min(1).describe('Attempt returned by the start endpoint.'),
    authorizationCode: z.string().min(1).describe('One-time code returned by Lovelace.'),
  })
  .meta({ id: 'LatticeAuthorizeComplete', description: 'Complete a FedCM authorization.' });

/** Coarse completion outcome; provider text never crosses this boundary. */
const LatticeAuthorizeResultOut = z
  .object({ status: z.enum(['connected', 'declined', 'error', 'scopes']) })
  .meta({ id: 'LatticeAuthorizeResultOut', description: 'Lattice authorization outcome.' });

/** Choosing which device runs Athena's turns. */
const LatticeDeviceSelect = z
  .object({
    deviceId: z.string().min(1).describe('The device to run Athena’s model turns on.'),
    enabled: z
      .boolean()
      .optional()
      .describe('Whether to switch Athena onto it immediately. Defaults to true.'),
  })
  .meta({ id: 'LatticeDeviceSelect', description: 'Point Athena at one device.' });

/** Turning the connection on or off without losing the grant or the device choice. */
const LatticeEnableUpdate = z
  .object({ enabled: z.boolean().describe('Whether Athena’s turns run on the device.') })
  .meta({ id: 'LatticeEnableUpdate', description: 'Switch the Lattice backend on or off.' });

/** Return the authenticated owner or fail closed. */
function requestOwner(c: { get(key: 'session'): AppEnv['Variables']['session'] }): string {
  const owner = c.get('session')?.user.id;
  if (!owner) throw new AuthError();
  return owner;
}

/** Narrow a stored device-status string, tolerating a value written by an older build. */
function toDeviceStatus(value: string | null): z.infer<typeof DeviceStatusEnum> | null {
  const parsed = DeviceStatusEnum.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** Narrow a stored reason string, tolerating a value written by an older build. */
function toUnavailableReason(value: string | null): LatticeUnavailableReason | null {
  const parsed = UnavailableReasonEnum.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/**
 * Project a connection row (or its absence) into the status DTO.
 *
 * @param row - The owner's connection, or null when they have never connected.
 * @returns The status payload.
 */
export function toLatticeStatus(
  row: LatticeConnectionRow | null,
): z.input<typeof LatticeStatusOut> {
  const configured = latticeConfigured();
  return {
    available: configured,
    deploymentReason: configured ? null : 'not_configured',
    connected: row?.status === 'connected',
    enabled: row?.enabled ?? false,
    deviceId: row?.deviceId ?? null,
    deviceName: row?.deviceName ?? null,
    deviceStatus: toDeviceStatus(row?.deviceStatus ?? null),
    scopes: [...LATTICE_SCOPES],
    grantedScope: row?.grantedScope ?? null,
    unavailableReason: toUnavailableReason(row?.lastFailureReason ?? null),
  };
}

/**
 * Refuse a mutating route while the shared OAuth client is unconfigured.
 *
 * @remarks
 * The read route deliberately does NOT call this: an unconfigured deployment still has to be able
 * to say why the section is unavailable, and a 409 would leave the surface with nothing true to
 * render.
 *
 * @throws {ConflictError} When the deployment cannot offer Lattice.
 */
function assertLatticeAvailable(): void {
  if (!latticeConfigured()) {
    throw new ConflictError('Lattice is not configured for this deployment');
  }
}

/** Load the owner's connection or 404. */
async function requireConnection(ownerUserId: string): Promise<LatticeConnectionRow> {
  const row = await loadLatticeConnection(ownerUserId);
  if (!row) throw new NotFoundError('Lattice connection');
  return row;
}

/**
 * Record a Lattice failure and return its stable reason, rethrowing anything else.
 *
 * @param cause - The thrown value.
 * @param ownerUserId - Whose connection to stamp the failure on.
 * @returns The actionable reason to report in the payload.
 */
async function reasonFor(cause: unknown, ownerUserId: string): Promise<LatticeUnavailableReason> {
  if (!(cause instanceof LatticeUnavailableError)) throw cause;
  await recordLatticeFailure(ownerUserId, cause.reason);
  return cause.reason;
}

/** Owner-only Lattice router, mounted under `/v1/me/athena`. */
const lattice = new Hono<AppEnv>()
  .get(
    '/lattice',
    apiDoc({
      tag: 'Athena',
      summary: 'Read the Lattice connection',
      response: LatticeStatusOut,
      description:
        'Report whether this deployment offers Lattice, whether the authenticated user has authorized Lovelace, and which of their devices Athena’s model turns run on. Never returns a token.',
    }),
    async (c) => {
      const row = await loadLatticeConnection(requestOwner(c));
      return ok(c, LatticeStatusOut, toLatticeStatus(row));
    },
  )
  .post(
    '/lattice/authorize',
    apiDoc({
      tag: 'Athena',
      summary: 'Start the Lovelace authorization',
      response: LatticeAuthorizeOut,
      description:
        'Begin one OAuth 2.1 authorization-code + PKCE attempt and return both redirect and FedCM inputs. The verifier is sealed in a short-lived attempt; any active grant remains untouched.',
    }),
    async (c) => {
      assertLatticeAvailable();
      const ownerUserId = requestOwner(c);
      const existing = await loadLatticeConnection(ownerUserId);
      const row =
        existing ??
        (
          await db.insert(latticeConnection).values({ ownerUserId, status: 'pending' }).returning()
        )[0];
      if (!row) throw new ConflictError('Could not start a Lattice authorization');

      if (row.status !== 'connected') {
        await db
          .update(latticeConnection)
          .set({ status: 'pending', lastFailureReason: null, lastFailureAt: null })
          .where(eq(latticeConnection.id, row.id));
      }
      return ok(
        c,
        LatticeAuthorizeOut,
        await startLatticeAuthorizationAttempt(row.id, ownerUserId),
      );
    },
  )
  .post(
    '/lattice/authorize/complete',
    apiDoc({
      tag: 'Athena',
      summary: 'Complete the Lovelace authorization',
      response: LatticeAuthorizeResultOut,
      description:
        'Exchange the one-time code returned by an active FedCM ceremony against the owner-bound PKCE attempt and install the grant only after its scopes are verified.',
    }),
    zJson(LatticeAuthorizeComplete),
    async (c) => {
      assertLatticeAvailable();
      const ownerUserId = requestOwner(c);
      const body = c.req.valid('json');
      const status = await completeLatticeAuthorizationAttempt({
        attemptId: body.attemptId,
        ownerUserId,
        authorizationCode: body.authorizationCode,
      });
      if (status === null) throw new NotFoundError('Lattice authorization attempt');
      return ok(c, LatticeAuthorizeResultOut, { status });
    },
  )
  .get(
    '/lattice/devices',
    apiDoc({
      tag: 'Athena',
      summary: 'List the user’s Lattice devices',
      response: LatticeDeviceListOut,
      description:
        'List every personal Lattice runtime the authorized Lovelace account owns, with live reachability. Revoked devices are included so a previously chosen device never silently vanishes from the picker. A gateway that cannot be read returns an empty list plus a stable reason rather than an error.',
    }),
    async (c) => {
      assertLatticeAvailable();
      const ownerUserId = requestOwner(c);
      const row = await requireConnection(ownerUserId);
      try {
        const context = await latticeGatewayContext(row);
        const devices = await listLatticeDevices(context);
        await db
          .update(latticeConnection)
          .set({
            lastVerifiedAt: new Date(),
            lastFailureReason: null,
            lastFailureAt: null,
            // A chosen device that is no longer on the account reads as revoked rather than
            // keeping its last-known-good status, which would claim a machine is fine when the
            // account can no longer see it at all.
            ...(row.deviceId
              ? {
                  deviceStatus:
                    devices.find((device) => device.id === row.deviceId)?.status ?? 'revoked',
                }
              : {}),
          })
          .where(eq(latticeConnection.id, row.id));
        return ok(c, LatticeDeviceListOut, {
          devices: devices.map((device) => ({
            ...device,
            selected: device.id === row.deviceId,
          })),
          unavailableReason: null,
        });
      } catch (cause) {
        return ok(c, LatticeDeviceListOut, {
          devices: [],
          unavailableReason: await reasonFor(cause, ownerUserId),
        });
      }
    },
  )
  .post(
    '/lattice/device',
    apiDoc({
      tag: 'Athena',
      summary: 'Point Athena at one device',
      response: LatticeStatusOut,
      description:
        'Choose which of the user’s Lattice devices runs Athena’s model turns, and switch the backend on. The device must currently exist on the authorized account; otherwise the connection is returned unchanged with an actionable reason.',
    }),
    zJson(LatticeDeviceSelect),
    async (c) => {
      assertLatticeAvailable();
      const ownerUserId = requestOwner(c);
      const row = await requireConnection(ownerUserId);
      const body = c.req.valid('json');
      try {
        const context = await latticeGatewayContext(row);
        const devices = await listLatticeDevices(context);
        const device = devices.find((candidate) => candidate.id === body.deviceId);
        // Selecting a device the account does not have would produce a connection that fails every
        // turn with `device_missing`; refusing here keeps the stored state truthful.
        if (!device) throw new LatticeUnavailableError('device_missing');
        const [updated] = await db
          .update(latticeConnection)
          .set({
            deviceId: device.id,
            deviceName: device.name,
            deviceStatus: device.status,
            enabled: body.enabled ?? true,
            status: 'connected',
            lastFailureReason: null,
            lastFailureAt: null,
            lastVerifiedAt: new Date(),
          })
          .where(eq(latticeConnection.id, row.id))
          .returning();
        return ok(c, LatticeStatusOut, toLatticeStatus(updated ?? row));
      } catch (cause) {
        const reason = await reasonFor(cause, ownerUserId);
        return ok(c, LatticeStatusOut, {
          ...toLatticeStatus(row),
          unavailableReason: reason,
        });
      }
    },
  )
  .patch(
    '/lattice',
    apiDoc({
      tag: 'Athena',
      summary: 'Switch the Lattice backend on or off',
      response: LatticeStatusOut,
      description:
        'Turn the connected Lattice backend on or off without discarding the grant or the device choice. Switching off returns Athena to the routed default backend.',
    }),
    zJson(LatticeEnableUpdate),
    async (c) => {
      assertLatticeAvailable();
      const ownerUserId = requestOwner(c);
      const row = await requireConnection(ownerUserId);
      const { enabled } = c.req.valid('json');
      if (enabled && !row.deviceId) {
        // Mirrors `lattice_connection_enabled_needs_device_check` so the caller gets an actionable
        // state rather than a constraint violation.
        return ok(c, LatticeStatusOut, {
          ...toLatticeStatus(row),
          unavailableReason: 'no_device_selected',
        });
      }
      const [updated] = await db
        .update(latticeConnection)
        .set({ enabled })
        .where(eq(latticeConnection.id, row.id))
        .returning();
      return ok(c, LatticeStatusOut, toLatticeStatus(updated ?? row));
    },
  )
  .delete(
    '/lattice',
    apiDoc({
      tag: 'Athena',
      summary: 'Disconnect Lovelace',
      response: LatticeStatusOut,
      description:
        'Delete the stored grant and device choice while retaining the connection identity for delegation history. Athena returns to the routed default backend immediately. This does not revoke the grant inside Lovelace — the user does that from their Lovelace account.',
    }),
    async (c) => {
      const ownerUserId = requestOwner(c);
      const row = await loadLatticeConnection(ownerUserId);
      const disconnected = row
        ? await db.transaction(async (tx) => {
            await tx
              .delete(latticeAuthorizationAttempt)
              .where(eq(latticeAuthorizationAttempt.connectionId, row.id));
            await tx.delete(latticeCredential).where(eq(latticeCredential.connectionId, row.id));
            const [updated] = await tx
              .update(latticeConnection)
              .set({
                status: 'disconnected',
                enabled: false,
                deviceId: null,
                deviceName: null,
                deviceStatus: null,
                grantedScope: null,
                accountId: null,
                lastFailureReason: null,
                lastFailureAt: null,
                lastVerifiedAt: null,
              })
              .where(eq(latticeConnection.id, row.id))
              .returning();
            return updated ?? null;
          })
        : null;
      return ok(c, LatticeStatusOut, toLatticeStatus(disconnected));
    },
  );

export { LatticeDeviceListOut, LatticeDeviceOut, LatticeStatusOut };
export default lattice;
