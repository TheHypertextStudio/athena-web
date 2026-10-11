/** Personal notification-triage consent; the server owns the activation timestamp. */
import { Hono } from 'hono';
import {
  NotificationTriageSettingsIn,
  NotificationTriageSettingsOut,
} from '@docket/athena/inbound-contract';
import type { AppEnv } from '../context';
import { apiDoc } from '../lib/openapi-route';
import { zJson } from '../lib/validate';
import { ok } from '../lib/ok';
import { callerHub } from './work-location-route-context';
import {
  readNotificationTriageSettings,
  setNotificationTriageSettings,
} from '../services/device-notifications/triage-settings';

/** Read or replace the signed-in person's explicit triage choice. */
export const meNotificationTriage = new Hono<AppEnv>()
  .get(
    '/',
    apiDoc({
      tag: 'Me',
      summary: 'Read notification triage consent',
      response: NotificationTriageSettingsOut,
    }),
    async (c) =>
      ok(
        c,
        NotificationTriageSettingsOut,
        await readNotificationTriageSettings(await callerHub(c)),
      ),
  )
  .put(
    '/',
    apiDoc({
      tag: 'Me',
      summary: 'Set notification triage consent',
      response: NotificationTriageSettingsOut,
    }),
    zJson(NotificationTriageSettingsIn),
    async (c) =>
      ok(
        c,
        NotificationTriageSettingsOut,
        await setNotificationTriageSettings(await callerHub(c), c.req.valid('json').enabled),
      ),
  );
