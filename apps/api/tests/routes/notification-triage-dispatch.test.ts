import { beforeAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import type * as ApiEnv from '../../src/env';
import {
  deviceNotificationDb,
  seedDevicePerson,
  registerDevice,
  notificationItem,
  upload,
} from '../support/device-notifications';

const execution = vi.hoisted(() => ({ admit: vi.fn(), run: vi.fn() }));
vi.mock('../../src/env', async (original) => {
  const mod = await original<typeof ApiEnv>();
  return { ...mod, env: { ...mod.env, NOTIFICATION_TRIAGE_DISPATCH: 'enabled' } };
});
vi.mock('../../src/agent/async-runner', () => ({ admitAthenaGeneration: execution.admit }));
vi.mock('../../src/routes/agent-session-runner', () => ({ runSession: execution.run }));
beforeAll(deviceNotificationDb);

describe('notification triage scheduled recovery', () => {
  it('recovers interrupted admission with one session and honors the dispatch kill switch', async () => {
    const f = await seedDevicePerson();
    const { setNotificationTriageSettings } =
      await import('../../src/services/device-notifications/triage-settings');
    const { sweepNotificationTriage } =
      await import('../../src/services/device-notifications/triage-dispatch');
    const { env } = await import('../../src/env');
    const enabled = await setNotificationTriageSettings(f.hubId, true);
    const source = await registerDevice(f.app);
    await upload(f.app, source, [notificationItem({ capturedAt: (enabled.enabledAt ?? 0) + 1 })]);
    execution.admit.mockRejectedValueOnce(new Error('Interrupted before admission'));
    const first = await sweepNotificationTriage();
    expect(first.failed).toBe(1);
    const mod = await deviceNotificationDb();
    const [settings] = await mod.db
      .select()
      .from(mod.notificationTriageSettings)
      .where(eq(mod.notificationTriageSettings.hubId, f.hubId));
    const sessionId = settings?.activeSessionId;
    expect(sessionId).toBeTruthy();
    execution.admit.mockResolvedValue({ mode: 'sync' });
    execution.run.mockResolvedValue(undefined);
    const next = await sweepNotificationTriage(new Date(Date.now() + 1));
    expect(next.dispatched).toBe(1);
    expect(execution.admit.mock.calls.at(-1)?.[0].id).toBe(sessionId);
    expect(execution.run).toHaveBeenCalledWith('', sessionId);
    Reflect.set(env, 'NOTIFICATION_TRIAGE_DISPATCH', 'paused');
    expect(await sweepNotificationTriage()).toEqual({ claimed: 0, dispatched: 0, failed: 0 });
  });
});
