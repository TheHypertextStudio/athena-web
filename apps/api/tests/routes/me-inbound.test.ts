import { beforeAll, describe, expect, it } from 'vitest';
import {
  deviceNotificationDb,
  seedDevicePerson,
  registerDevice,
  notificationItem,
  removalItem,
  JSON_HEADERS,
  ulid,
} from '../support/device-notifications';
import { Hono } from 'hono';
import { appWithSession, fakeSession } from '../support/routes-harness';

beforeAll(deviceNotificationDb);

async function fixture() {
  const person = await seedDevicePerson();
  const { meInbound } = await import('../../src/routes/me-inbound');
  const app = appWithSession(
    new Hono().route('/me/inbound', meInbound as never),
    fakeSession(person.userId),
  );
  const sourceId = await registerDevice(person.app);
  return { ...person, inbound: app, sourceId };
}

function captured(item = notificationItem()) {
  return {
    id: item.id,
    type: 'platform.notification.captured',
    occurredAt: item.capturedAt,
    payload: item,
  };
}

function send(
  app: Awaited<ReturnType<typeof fixture>>['inbound'],
  sourceId: string,
  events: unknown[],
  schemaVersion = 1,
) {
  return app.request('/me/inbound', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ schemaVersion, sourceId, events }),
  });
}

describe('personal inbound events', () => {
  it('stores captures before removals and acknowledges request order, including retries', async () => {
    const f = await fixture();
    const item = notificationItem();
    const removal = removalItem(item.id);
    const events = [
      {
        id: removal.id,
        type: 'platform.notification.removed',
        occurredAt: removal.removedAt,
        payload: removal,
      },
      captured(item),
    ];
    expect(await (await send(f.inbound, f.sourceId, events)).json()).toEqual({
      events: [
        { id: removal.id, status: 'stored' },
        { id: item.id, status: 'stored' },
      ],
    });
    expect(await (await send(f.inbound, f.sourceId, events)).json()).toEqual({
      events: [
        { id: removal.id, status: 'duplicate' },
        { id: item.id, status: 'duplicate' },
      ],
    });
  });

  it('rejects unsupported and malformed events without losing valid siblings', async () => {
    const f = await fixture();
    const good = captured();
    const unsupported = { ...captured(), type: 'unsupported' };
    const malformed = { ...captured(), payload: { id: ulid() } };
    const response = await send(f.inbound, f.sourceId, [unsupported, good, malformed]);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      events: [
        { id: unsupported.id, status: 'invalid' },
        { id: good.id, status: 'stored' },
        { id: malformed.id, status: 'invalid' },
      ],
    });
    expect((await send(f.inbound, f.sourceId, [good], 2)).status).toBe(422);
  });

  it('refuses an unregistered or another person’s source', async () => {
    const f = await fixture();
    const other = await fixture();
    expect((await send(other.inbound, f.sourceId, [captured()])).status).toBe(404);
    expect((await send(f.inbound, ulid(), [captured()])).status).toBe(404);
  });
  it('retains hub-wide event identity across event types and requests', async () => {
    const f = await fixture();
    const item = notificationItem();
    await send(f.inbound, f.sourceId, [captured(item)]);
    const removal = removalItem(item.id, { id: item.id });
    const response = await send(f.inbound, f.sourceId, [
      {
        id: item.id,
        type: 'platform.notification.removed',
        occurredAt: removal.removedAt,
        payload: removal,
      },
    ]);
    expect(await response.json()).toEqual({ events: [{ id: item.id, status: 'duplicate' }] });
  });
});
