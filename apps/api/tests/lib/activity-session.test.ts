import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { buildCorsMiddleware } from '../../src/cors';
import { ValidationError } from '../../src/error';
import { activitySessionOf, withActivitySession } from '../../src/lib/provenance/activity-session';
import {
  appProvenance,
  athenaProvenance,
  clientProvenance,
} from '../../src/lib/provenance/context';

const client = clientProvenance('mcp', { name: 'Codex', id: 'client_1' });
const scope = { taskId: 'task_1', actorId: 'actor_1' };

describe('activity session protocol', () => {
  it('allows the correlation header through a trusted browser preflight', async () => {
    const app = new Hono();
    app.use('*', buildCorsMiddleware(['https://docket.example']));
    app.all('*', (c) => c.text('ok'));
    const response = await app.request('/v1/orgs/org/tasks/task', {
      method: 'OPTIONS',
      headers: {
        origin: 'https://docket.example',
        'access-control-request-method': 'PATCH',
        'access-control-request-headers': 'Docket-Activity-Session',
      },
    });
    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-headers')?.toLowerCase()).toContain(
      'docket-activity-session',
    );
  });

  it('keeps a logical work identity across reconnects without exposing transport handles', () => {
    const first = withActivitySession({ ...client, sessionId: 'secret_transport_a' }, 'work_1');
    const second = withActivitySession({ ...client, sessionId: 'secret_transport_b' }, 'work_1');
    const a = activitySessionOf(scope, { ...first, tool: 'update' });
    expect(a).toMatchObject({ kind: 'work', title: 'Codex session' });
    expect(a).toEqual(activitySessionOf(scope, { ...second, tool: 'comment' }));
    expect(JSON.stringify(a)).not.toContain('secret_transport');
    expect(JSON.stringify(a)).not.toContain('work_1');
  });

  it('qualifies keys by caller, task, client and channel', () => {
    const origin = { ...withActivitySession(client, 'same'), tool: 'update' };
    const a = activitySessionOf(scope, origin);
    expect(activitySessionOf({ ...scope, actorId: 'other' }, origin)).not.toEqual(a);
    expect(activitySessionOf({ ...scope, taskId: 'other' }, origin)).not.toEqual(a);
    expect(activitySessionOf(scope, { ...origin, clientId: 'other' })).not.toEqual(a);
    expect(activitySessionOf(scope, { ...origin, channel: 'api' })).not.toEqual(a);
    expect(activitySessionOf(scope, { ...origin, activitySessionId: 'other' })).not.toEqual(a);
  });

  it('labels legacy connections honestly and never groups people or unknown origins', () => {
    expect(
      activitySessionOf(scope, { ...client, sessionId: 'transport', tool: 'update' }),
    ).toMatchObject({ kind: 'connection', title: 'Codex connection' });
    expect(
      activitySessionOf(scope, { ...appProvenance(), sessionId: 'x', tool: 'update' }),
    ).toBeNull();
    expect(activitySessionOf(scope, null)).toBeNull();
    expect(activitySessionOf(scope, { ...client, tool: 'update' })).toBeNull();
    expect(withActivitySession(appProvenance(), 'work')).not.toHaveProperty('activitySessionId');
  });

  it('gives native execution precedence over client metadata', () => {
    const native = athenaProvenance('session', 'native_1');
    const original = activitySessionOf(scope, { ...native, tool: 'update' });
    expect(
      activitySessionOf(scope, { ...withActivitySession(native, 'external'), tool: 'update' }),
    ).toEqual(original);
    expect(original).toMatchObject({ kind: 'native', title: 'Athena session' });
  });

  it.each(['', 'a b', 'x\nspoof', 'x'.repeat(129), 42, { id: 'work' }])(
    'rejects malformed keys %j',
    (key) => {
      expect(() => withActivitySession(client, key)).toThrow(ValidationError);
    },
  );
});
