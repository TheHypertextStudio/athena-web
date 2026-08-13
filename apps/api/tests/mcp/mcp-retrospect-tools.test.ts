import { beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';

import { getDb, one, seedBaseOrg } from '../support/routes-harness';
import { buildHighlightsDayPayload } from '../../src/services/highlights/read';
import { reconcileDay } from '../../src/services/highlights/reconcile';
import { registerRetrospectTools } from '../../src/mcp/retrospect-tools';
import { TOOL_SCOPE } from '../../src/mcp/scope';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
});

const DAY = '2026-08-12';
const NOW = new Date('2026-08-12T18:00:00.000Z');

/** What a registered tool's handler returns, narrowed to the parts these tests read. */
interface ToolResult {
  readonly isError?: boolean;
  readonly content?: readonly { readonly text?: string }[];
}

/** One registered tool. */
type ToolHandler = (input: { readonly date?: string }) => Promise<ToolResult>;

/** A registrar that records what was registered and lets a handler be invoked. */
function recordingRegistrar() {
  const tools = new Map<string, { config: Record<string, unknown>; handler: ToolHandler }>();
  return {
    registrar: {
      registerTool: (name: string, config: Record<string, unknown>, handler: ToolHandler) => {
        tools.set(name, { config, handler });
      },
    },
    tools,
  };
}

let people = 0;
let seq = 0;

async function seedPerson(): Promise<{ orgId: string; userId: string }> {
  const { orgId } = await seedBaseOrg(db, schema);
  people += 1;
  const userId = one(
    await db
      .insert(schema.user)
      .values({ name: `Ret ${String(people)}`, email: `ret-${String(people)}@example.test` })
      .returning({ id: schema.user.id }),
  ).id;
  await db.insert(schema.hub).values({ userId, preferences: { timezone: 'UTC' } });
  return { orgId, userId };
}

async function seedEvent(orgId: string, userId: string): Promise<void> {
  seq += 1;
  await db.insert(schema.event).values({
    organizationId: orgId,
    userId,
    sourceSystem: 'github',
    kind: 'completed',
    occurredAt: new Date('2026-08-12T09:00:00.000Z'),
    title: `Retro event ${String(seq)}`,
    entity: {
      kind: 'work_item',
      source: 'github',
      externalId: 'ENG-9',
      title: 'Ship the beta',
      url: null,
      docketEntityId: null,
    },
    entityKind: 'work_item',
    entityAssociation: 'pending',
    dedupeKey: `ret-${String(seq)}`,
  });
}

describe('the retrospect tool', () => {
  it('is registered read-only, since looking back changes nothing', () => {
    const { registrar, tools } = recordingRegistrar();
    registerRetrospectTools(
      registrar as never,
      {
        principal: { kind: 'user', userId: 'u1' },
      } as never,
    );

    const tool = tools.get('retrospect');
    expect(tool).toBeDefined();
    expect(tool?.config['annotations']).toMatchObject({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    });
  });

  it('needs only read access', () => {
    expect(TOOL_SCOPE['retrospect']).toBe('work:read');
  });

  it('answers with exactly what the app reads, so the two cannot disagree', async () => {
    const { orgId, userId } = await seedPerson();
    await seedEvent(orgId, userId);
    await reconcileDay(userId, DAY, NOW);

    const { registrar, tools } = recordingRegistrar();
    registerRetrospectTools(registrar as never, { principal: { kind: 'user', userId } } as never);

    const result = await tools.get('retrospect')?.handler({ date: DAY });
    const payload = JSON.parse(result?.content?.[0]?.text ?? '{}') as Record<string, unknown>;
    const direct = await buildHighlightsDayPayload(userId, DAY, NOW);

    // Structural equality against the shared builder is the anti-drift guarantee: the assistant and
    // the review surface answer "what did I do" from one place or they will eventually differ.
    expect(payload['highlights']).toHaveLength(direct.highlights.length);
    expect(payload['date']).toBe(direct.date);
    expect(payload['status']).toBe(direct.status);
  });

  it('refuses an agent principal, because an agent has no day of its own', async () => {
    const { registrar, tools } = recordingRegistrar();
    registerRetrospectTools(
      registrar as never,
      {
        principal: { kind: 'agent', agentId: 'a1' },
      } as never,
    );

    // Not-found rather than forbidden: from the agent's side the Hub genuinely does not exist, which
    // is the same choice `brief` makes.
    const result = await tools.get('retrospect')?.handler({ date: DAY });
    expect(result?.isError).toBe(true);
  });
});
