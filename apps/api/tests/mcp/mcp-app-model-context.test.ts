/**
 * `ui/update-model-context` retention and delivery — a widget's word reaches the model
 * exactly once, bounded, and never with the principal's voice.
 *
 * @remarks
 * Three properties carry the extension's contract: retention is scoped by the same ownership
 * ladder as a widget tool call, each retention overwrites the last so only the latest update
 * reaches the model, and delivery rides the next user turn inside the third-party provenance
 * envelope — then never again.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';

const getSession = vi.fn(async () => null);
vi.mock('@docket/auth', () => ({ auth: { api: { getSession } } }));

import type * as DbModule from '@docket/db';
import { MCP_UI_MIME_TYPE } from '@docket/integrations/mcp-apps-contract';
import { eq } from 'drizzle-orm';

import type { retainWidgetModelContext as RetainWidgetModelContext } from '../../src/mcp/apps/host-routes';
import type { takePendingWidgetModelContexts as TakePendingWidgetModelContexts } from '../../src/mcp/apps/model-context';
import type { recordInboundReply as RecordInboundReply } from '../../src/routes/agent-session-runner';
import type { toActivityOut as ToActivityOut } from '../../src/routes/agent-session-helpers';
import { getMigratedDb } from '../support/db';
import { assertDefined } from '@docket/test-utils';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let retainWidgetModelContext!: typeof RetainWidgetModelContext;
let takePendingWidgetModelContexts!: typeof TakePendingWidgetModelContexts;
let recordInboundReply!: typeof RecordInboundReply;
let toActivityOut!: typeof ToActivityOut;

beforeAll(async () => {
  schema = await getMigratedDb();
  db = schema.db;
  ({ retainWidgetModelContext } = await import('../../src/mcp/apps/host-routes'));
  ({ takePendingWidgetModelContexts } = await import('../../src/mcp/apps/model-context'));
  ({ recordInboundReply } = await import('../../src/routes/agent-session-runner'));
  ({ toActivityOut } = await import('../../src/routes/agent-session-helpers'));
});

/** Seed an owner, their connected server, an org, a chat session, and one rendered card. */
async function seedCard() {
  const slug = `mc-${Math.random().toString(36).slice(2, 10)}`;
  const [user] = await db
    .insert(schema.user)
    .values({ name: 'Ada', email: `${slug}@example.com` })
    .returning({ id: schema.user.id });
  const userId = assertDefined(user).id;
  const [org] = await db
    .insert(schema.organization)
    .values({ name: `Org ${slug}`, slug })
    .returning({ id: schema.organization.id });
  const orgId = assertDefined(org).id;
  const [connection] = await db
    .insert(schema.personalMcpConnection)
    .values({
      ownerUserId: userId,
      url: 'https://mcp.acme-release.example/mcp',
      name: 'Weather Service',
      alias: slug.replace(/-/g, ''),
      authMode: 'none',
      status: 'connected',
      toolCount: 1,
    })
    .returning({ id: schema.personalMcpConnection.id });
  const connectionId = assertDefined(connection).id;
  const [session] = await db
    .insert(schema.agentSession)
    .values({
      executorKind: 'athena',
      ownerUserId: userId,
      contextOrganizationId: orgId,
      kind: 'chat',
      trigger: 'delegation',
      status: 'pending',
    })
    .returning({ id: schema.agentSession.id });
  const sessionId = assertDefined(session).id;
  const [activity] = await db
    .insert(schema.sessionActivity)
    .values({
      sessionId,
      organizationId: null,
      type: 'action',
      body: {
        action: {
          kind: 'remote_tool',
          summary: 'Show Dallas weather',
          result: {
            content: '72 degrees',
            isError: false,
            presentation: {
              connectionId,
              serverName: 'Weather Service',
              tool: 'weather_card',
              arguments: { city: 'Dallas' },
              result: { content: [{ type: 'text', text: '72 degrees' }] },
              resource: {
                uri: 'ui://weather/card',
                mimeType: MCP_UI_MIME_TYPE,
                text: '<!doctype html><html><head></head><body>weather</body></html>',
              },
            },
          },
        },
      },
    })
    .returning({ id: schema.sessionActivity.id });
  return { userId, orgId, connectionId, sessionId, activityId: assertDefined(activity).id };
}

async function activityRow(activityId: string) {
  const [row] = await db
    .select()
    .from(schema.sessionActivity)
    .where(eq(schema.sessionActivity.id, activityId))
    .limit(1);
  return assertDefined(row);
}

describe('retention', () => {
  it('retains a bounded context update for a card the caller owns', async () => {
    const { userId, connectionId, activityId } = await seedCard();
    await retainWidgetModelContext(userId, connectionId, activityId, {
      content: [{ type: 'text', text: 'the user pinned Dallas' }],
      structuredContent: { city: 'Dallas' },
    });
    const row = await activityRow(activityId);
    expect(row.body.action?.result?.modelContext).toEqual({
      text: 'the user pinned Dallas',
      structuredContent: { city: 'Dallas' },
    });
    expect(row.body.action?.result?.modelContextDelivered).toBe(false);
  });

  it('refuses another owner’s card as a miss, not a denial', async () => {
    const mine = await seedCard();
    const theirs = await seedCard();
    await expect(
      retainWidgetModelContext(mine.userId, mine.connectionId, theirs.activityId, {
        content: [{ type: 'text', text: 'x' }],
      }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('refuses a card that a different connection produced', async () => {
    const first = await seedCard();
    const second = await seedCard();
    // Give the caller a second connection of their own that did NOT produce the card.
    await expect(
      retainWidgetModelContext(second.userId, second.connectionId, first.activityId, {
        content: [{ type: 'text', text: 'x' }],
      }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('refuses a payload the bounded parse rejects', async () => {
    const { userId, connectionId, activityId } = await seedCard();
    await expect(
      retainWidgetModelContext(userId, connectionId, activityId, {
        content: [{ type: 'text', text: 'looks fine' }],
        structuredContent: { apiKey: 'sk-forbidden' },
      }),
    ).rejects.toMatchObject({ status: 422 });
    await expect(
      retainWidgetModelContext(userId, connectionId, activityId, {
        content: [{ type: 'image', data: 'x', mimeType: 'image/png' }],
      }),
    ).rejects.toMatchObject({ status: 422 });
  });
});

describe('delivery', () => {
  it('overwrites the previous context so only the last update reaches the model', async () => {
    const { userId, connectionId, sessionId, activityId } = await seedCard();
    await retainWidgetModelContext(userId, connectionId, activityId, {
      content: [{ type: 'text', text: 'first draft' }],
    });
    await retainWidgetModelContext(userId, connectionId, activityId, {
      content: [{ type: 'text', text: 'final answer' }],
    });
    const pending = await takePendingWidgetModelContexts(db, sessionId);
    expect(pending).toHaveLength(1);
    expect(assertDefined(pending[0]).text).toBe('final answer');
    expect(assertDefined(pending[0]).origin).toBe('Weather Service app (weather_card)');
  });

  it('delivers the stored context on the next user turn, exactly once', async () => {
    const { userId, orgId, connectionId, sessionId, activityId } = await seedCard();
    await retainWidgetModelContext(userId, connectionId, activityId, {
      content: [{ type: 'text', text: 'the user pinned Dallas' }],
    });

    await recordInboundReply(orgId, sessionId, userId, 'What is the weather now?', 'principal');
    const [first] = await db
      .select()
      .from(schema.agentSessionTranscript)
      .where(eq(schema.agentSessionTranscript.sessionId, sessionId))
      .limit(1);
    const turns = assertDefined(first).messages as {
      role: string;
      content: { type: string; text?: string }[];
    }[];
    const lastTurn = assertDefined(turns.at(-1));
    expect(lastTurn.role).toBe('user');
    expect(lastTurn.content).toHaveLength(2);
    const envelope = assertDefined(lastTurn.content[0]?.text);
    expect(envelope).toContain('<docket:external source="mcp_app"');
    expect(envelope).toContain('Weather Service app (weather_card)');
    expect(envelope).toContain('the user pinned Dallas');
    expect(lastTurn.content[1]?.text).toBe('What is the weather now?');

    await recordInboundReply(orgId, sessionId, userId, 'And tomorrow?', 'principal');
    const [second] = await db
      .select()
      .from(schema.agentSessionTranscript)
      .where(eq(schema.agentSessionTranscript.sessionId, sessionId))
      .limit(1);
    const nextTurns = assertDefined(second).messages as {
      role: string;
      content: { type: string; text?: string }[];
    }[];
    const nextTurn = assertDefined(nextTurns.at(-1));
    expect(nextTurn.content).toHaveLength(1);
    expect(nextTurn.content[0]?.text).toBe('And tomorrow?');
  });

  it('strips a stored presentation that no longer parses, reporting it unavailable', async () => {
    const { sessionId } = await seedCard();
    const [row] = await db
      .insert(schema.sessionActivity)
      .values({
        sessionId,
        organizationId: null,
        type: 'action',
        body: {
          action: {
            kind: 'remote_tool',
            summary: 'Corrupted card',
            result: {
              content: 'Completed',
              isError: false,
              presentation: { connectionId: 'x' } as never,
            },
          },
        },
      })
      .returning({ id: schema.sessionActivity.id });
    const out = toActivityOut(await activityRow(assertDefined(row).id));
    const result = (out.body as { action?: { result?: Record<string, unknown> } }).action?.result;
    expect(result?.['presentation']).toBeUndefined();
    expect(result?.['presentationUnavailable']).toBe(true);
  });

  it('keeps the stored context out of every serialized activity body', async () => {
    const { userId, connectionId, activityId } = await seedCard();
    await retainWidgetModelContext(userId, connectionId, activityId, {
      content: [{ type: 'text', text: 'private note to the model' }],
    });
    const out = toActivityOut(await activityRow(activityId));
    const result = (out.body as { action?: { result?: Record<string, unknown> } }).action?.result;
    expect(result?.['modelContext']).toBeUndefined();
    expect(result?.['modelContextDelivered']).toBeUndefined();
    expect(result?.['presentation']).toMatchObject({ connectionId, tool: 'weather_card' });
  });
});
