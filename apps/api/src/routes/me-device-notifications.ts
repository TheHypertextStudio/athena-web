/**
 * `@docket/api` — device notification sync (mounted at `/v1/me/device-notification-sources` and
 * `/v1/me/device-notifications`).
 *
 * @remarks
 * A person's phone registers itself, uploads the notifications it indexed, and reads back the
 * deletions made elsewhere, so Athena can use that context from anywhere. Everything is keyed to the
 * signed-in person's hub, resolved from the session and never from the request, and nothing is
 * organization data. The contract is `@docket/athena/device-notification-contract`; the behaviour
 * is specified in `docs/engineering/specs/device-notification-sync.md`.
 */
import {
  DeviceNotificationBatchIn,
  DeviceNotificationBatchOut,
  DeviceNotificationDeleteOut,
  DeviceNotificationDeleteQuery,
  DeviceNotificationDeletionsOut,
  DeviceNotificationListOut,
  DeviceNotificationListQuery,
  DeviceNotificationSourceIn,
  DeviceNotificationSourceOut,
  DeviceNotificationSourceParam,
} from '@docket/athena/device-notification-contract';
import { Hono } from 'hono';

import type { AppEnv } from '../context';
import { NotFoundError } from '../error';
import { ok } from '../lib/ok';
import { apiDoc } from '../lib/openapi-route';
import { zJson, zParam, zQuery } from '../lib/validate';
import { ingestBatch } from '../services/device-notifications/ingest';
import {
  deleteNotifications,
  findSource,
  listNotifications,
  presentSource,
  readDeletions,
  registerSource,
} from '../services/device-notifications/store';
import { consumeUploadBatch } from '../services/device-notifications/upload-window';
import { callerHub } from './work-location-route-context';

/** Device registration, mounted at `/v1/me/device-notification-sources`. */
export const meDeviceNotificationSources = new Hono<AppEnv>()
  .get(
    '/:deviceId',
    apiDoc({
      tag: 'Me',
      summary: 'Get a notification device',
      response: DeviceNotificationSourceOut,
      description: `Read one of the caller's registered devices: its label, retention, consent time, and when it last registered or uploaded. Session-only. **401** when unauthenticated. **404** when the caller has not registered \`deviceId\`. Returns the {@link DeviceNotificationSourceOut}.`,
    }),
    zParam(DeviceNotificationSourceParam),
    async (c) => {
      const hubId = await callerHub(c);
      const source = await findSource(hubId, c.req.valid('param').deviceId);
      if (!source) throw new NotFoundError('Device is not registered');
      return ok(c, DeviceNotificationSourceOut, presentSource(source));
    },
  )
  .put(
    '/:deviceId',
    apiDoc({
      tag: 'Me',
      summary: 'Register a notification device',
      response: DeviceNotificationSourceOut,
      description: `Register one of the caller's devices as a source of synced notifications, or update its label, retention, and consent time. \`deviceId\` is the install's random ULID; the caller and the device id together identify a source, so one install used by two accounts is two sources. Call it before the first upload and whenever retention changes. \`retentionDays\` (1..3650) sets how long the server keeps what this device uploads from now on. Session-only. **401** when unauthenticated. **422** when the body or \`deviceId\` is malformed. Returns the {@link DeviceNotificationSourceOut}.`,
    }),
    zParam(DeviceNotificationSourceParam),
    zJson(DeviceNotificationSourceIn),
    async (c) => {
      const hubId = await callerHub(c);
      const source = await registerSource(
        hubId,
        c.req.valid('param').deviceId,
        c.req.valid('json'),
      );
      return ok(c, DeviceNotificationSourceOut, source);
    },
  );

/** Uploads, deletions, and the list, mounted at `/v1/me/device-notifications`. */
export const meDeviceNotifications = new Hono<AppEnv>()
  .post(
    '/batches',
    apiDoc({
      tag: 'Me',
      summary: 'Upload synced notifications',
      response: DeviceNotificationBatchOut,
      description: `Upload a batch of notifications and removals captured on a registered device. At most 100 notifications (each a \`DeviceNotificationIn\`, with at most 50 lines and 100 messages) and 200 removals (each a \`DeviceNotificationRemovalIn\`); every text field is at most 4,000 characters and every time is Unix milliseconds. Each item is validated on its own and answered in request order with one status: \`stored\`, \`duplicate\` (already stored, or repeated in the batch), \`deleted\` (a delete of everything or of its app happened at or after its capture), \`expired\` (captured longer ago than the device's retention), \`orphaned\` (a removal whose notification is not stored), or \`invalid\`. Messages are stored once per person by \`identity\`. Uploading also deletes the caller's expired entries. Session-only. **401** when unauthenticated. **404** when \`deviceId\` is not registered for the caller — register it and retry. **413** when the body exceeds 8 MiB — halve the batch. **422** when the batch shape itself is malformed. **429** with \`Retry-After\` after 240 batches in an hour. Returns {@link DeviceNotificationBatchOut}.`,
    }),
    zJson(DeviceNotificationBatchIn),
    async (c) => {
      const hubId = await callerHub(c);
      const now = new Date();
      await consumeUploadBatch(hubId, now);
      return ok(c, DeviceNotificationBatchOut, await ingestBatch(hubId, c.req.valid('json'), now));
    },
  )
  .get(
    '/deletions',
    apiDoc({
      tag: 'Me',
      summary: 'Read notification deletions',
      response: DeviceNotificationDeletionsOut,
      description: `Read the deletions the caller made on the server, from any device or the web. \`deletedBefore\` covers every app and \`apps\` covers one app each; a phone deletes its local entries captured at or before those times so a delete anywhere removes the copy everywhere. Session-only. **401** when unauthenticated. Returns {@link DeviceNotificationDeletionsOut}.`,
    }),
    async (c) => {
      const hubId = await callerHub(c);
      return ok(c, DeviceNotificationDeletionsOut, await readDeletions(hubId));
    },
  )
  .delete(
    '/',
    apiDoc({
      tag: 'Me',
      summary: 'Delete synced notifications',
      response: DeviceNotificationDeleteOut,
      description: `Delete everything the caller has synced from every device, or only one app's entries with \`appId\`, together with their messages and removals. Records the deletion time so later uploads of entries captured at or before it are answered \`deleted\`, and phones apply it through the deletions read. Session-only. **401** when unauthenticated. Returns {@link DeviceNotificationDeleteOut} with the number of notifications deleted.`,
    }),
    zQuery(DeviceNotificationDeleteQuery),
    async (c) => {
      const hubId = await callerHub(c);
      const { appId } = c.req.valid('query');
      return ok(c, DeviceNotificationDeleteOut, await deleteNotifications(hubId, appId));
    },
  )
  .get(
    '/',
    apiDoc({
      tag: 'Me',
      summary: 'List synced notifications',
      response: DeviceNotificationListOut,
      description: `List the caller's synced notifications, newest capture first, each with the messages first stored with it and its removal. Filter to one app with \`appId\`. Keyset-paginated: pass \`nextCursor\` back as \`cursor\`; \`limit\` is 1..200 (default 50). Expired entries are left out. Session-only. **401** when unauthenticated. **422** for a malformed cursor or limit. Returns {@link DeviceNotificationListOut}.`,
    }),
    zQuery(DeviceNotificationListQuery),
    async (c) => {
      const hubId = await callerHub(c);
      return ok(c, DeviceNotificationListOut, await listNotifications(hubId, c.req.valid('query')));
    },
  );
