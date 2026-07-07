/**
 * Wiring tests for the two automation Observer hook sites: the internal emit Facade
 * (`event-emit.ts`) and the external webhook drain (`event-sync.ts`), plus the depth-1
 * re-entrancy cap. The runtime module is wrapped (pass-through spy) so the drain-side hook —
 * whose only M1-era actions require Docket subjects — is still assertable.
 */
import { eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as DbModule from '@docket/db';

import type * as EmitModule from '../../src/routes/event-emit';
import type * as DrainModule from '../../src/routes/event-sync';
import type * as RuntimeModule from '../../src/lib/automation/runtime';
import { getDb, one, seedBaseOrg } from '../support/routes-harness';

const runSpy = vi.fn<(event: unknown) => void>();

vi.mock('../../src/lib/automation/runtime', async (importOriginal) => {
  const actual = await importOriginal<typeof RuntimeModule>();
  const wrapped: typeof actual.runAutomationsForEvent = (event, registry) => {
    runSpy(event);
    return actual.runAutomationsForEvent(event, registry);
  };
  return { ...actual, runAutomationsForEvent: wrapped };
});

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let emitEvent!: typeof EmitModule.emitEvent;
let sweepInboundEvents!: typeof DrainModule.sweepInboundEvents;
let runtime!: typeof RuntimeModule;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
  emitEvent = (await import('../../src/routes/event-emit')).emitEvent;
  sweepInboundEvents = (await import('../../src/routes/event-sync')).sweepInboundEvents;
  runtime = await import('../../src/lib/automation/runtime');
});

beforeEach(() => {
  runSpy.mockClear();
});

/** Seed a pending email suggestion on a Gmail integration; returns ids. */
async function seedSuggestion(orgId: string, actorId: string) {
  const integration = one(
    await db
      .insert(schema.integration)
      .values({
        organizationId: orgId,
        provider: 'gmail',
        pattern: 'connector',
        roles: ['signal'],
        createdBy: actorId,
      })
      .returning({ id: schema.integration.id }),
  );
  const suggestion = one(
    await db
      .insert(schema.emailSuggestion)
      .values({
        organizationId: orgId,
        createdBy: actorId,
        integrationId: integration.id,
        externalThreadId: 'thread_promo',
        title: '50% off everything',
        confidence: 5,
      })
      .returning({ id: schema.emailSuggestion.id }),
  );
  return { integrationId: integration.id, suggestionId: suggestion.id };
}

/** Insert the dismiss-promotions rule (the shipped seed shape) for an org. */
async function addDismissPromotionsRule(orgId: string): Promise<void> {
  await db.insert(schema.automationRule).values({
    organizationId: orgId,
    name: 'Dismiss promotional email suggestions',
    enabled: true,
    eventMatch: { kind: 'created', subjectType: 'email_suggestion' },
    condition: { op: 'eq', path: 'detail.category', value: 'promotions' },
    actions: [{ type: 'suggestion.dismiss', params: {} }],
  });
}

describe('hook site 1 — emitEvent runs automation rules post-commit', () => {
  it('dismisses a promo suggestion end-to-end (emit → match → predicate → handler)', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const { suggestionId } = await seedSuggestion(orgId, humanActorId);
    await addDismissPromotionsRule(orgId);

    await emitEvent({
      organizationId: orgId,
      kind: 'created',
      actorId: humanActorId,
      title: '50% off everything',
      subject: { type: 'email_suggestion', id: suggestionId, title: '50% off everything' },
      detail: { schema: 'docket.email_suggestion', category: 'promotions', confidence: 5 },
    });

    const row = one(
      await db
        .select({ status: schema.emailSuggestion.status })
        .from(schema.emailSuggestion)
        .where(eq(schema.emailSuggestion.id, suggestionId)),
    );
    expect(row.status).toBe('dismissed');
    expect(runSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'docket',
        kind: 'created',
        subjectType: 'email_suggestion',
        subjectId: suggestionId,
        detail: expect.objectContaining({ category: 'promotions' }),
      }),
    );
  });

  it('does not fire again for a duplicate emit (same dedupe key)', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const { suggestionId } = await seedSuggestion(orgId, humanActorId);
    const occurredAt = new Date('2026-07-01T09:00:00Z');
    const input: Parameters<typeof emitEvent>[0] = {
      organizationId: orgId,
      kind: 'created',
      occurredAt,
      title: '50% off everything',
      subject: { type: 'email_suggestion', id: suggestionId },
    };

    await emitEvent(input);
    await emitEvent(input); // duplicate — dedupe-key conflict, no insert
    expect(runSpy).toHaveBeenCalledTimes(1);
  });
});

describe('hook site 2 — the external drain runs automation rules per created event', () => {
  it('projects a drained Linear event and invokes the rule pass', async () => {
    const { orgId } = await seedBaseOrg(db, schema);
    const [u] = await db
      .insert(schema.user)
      .values({ name: 'Ada', email: `ada-hooks-${Date.now().toString()}@example.com` })
      .returning({ id: schema.user.id });
    const actor = one(
      await db
        .insert(schema.actor)
        .values({ organizationId: orgId, kind: 'human', displayName: 'Ada', userId: u!.id })
        .returning({ id: schema.actor.id }),
    );
    const integration = one(
      await db
        .insert(schema.integration)
        .values({
          organizationId: orgId,
          provider: 'linear',
          pattern: 'connector',
          roles: ['work'],
          connection: { externalWorkspaceId: 'ws' },
          status: 'connected',
          createdBy: actor.id,
        })
        .returning({ id: schema.integration.id }),
    );
    await db.insert(schema.inboundEvent).values({
      organizationId: orgId,
      integrationId: integration.id,
      provider: 'linear',
      externalEventId: 'ev_hook2',
      eventType: 'mock',
      payload: { kind: 'mention', title: 'You were mentioned', id: 'x-hook2' },
      signatureVerified: true,
    });

    await sweepInboundEvents(new Date());

    expect(runSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: orgId,
        source: 'linear',
        kind: 'mention',
        entityKind: 'work_item',
      }),
    );
  });
});

describe('re-entrancy — the depth-1 cascade cap', () => {
  it('suppresses a rule pass triggered from inside another rule dispatch', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    await db.insert(schema.automationRule).values({
      organizationId: orgId,
      createdBy: humanActorId,
      name: 'probe',
      enabled: true,
      eventMatch: {},
      condition: { op: 'and', nodes: [] },
      actions: [{ type: 'recursive.probe', params: {} }],
    });

    const event = {
      organizationId: orgId,
      kind: 'completed',
      source: 'docket',
      subjectType: 'task',
      subjectId: 'task-reentrancy',
      detail: {},
      occurredAt: new Date(0),
    };

    const { createRegistry } = await import('../../src/lib/automation/registry');
    const inner: unknown[] = [];
    const innerRegistry = createRegistry();
    innerRegistry.register({ type: 'recursive.probe', run: () => void inner.push('ran') });
    let outerRuns = 0;
    const outerRegistry = createRegistry();
    outerRegistry.register({
      type: 'recursive.probe',
      run: async () => {
        outerRuns += 1;
        // A handler emitting an event would land here: the nested pass must no-op.
        await runtime.runAutomationsForEvent(event, innerRegistry);
      },
    });

    await runtime.runAutomationsForEvent(event, outerRegistry);

    expect(outerRuns).toBe(1); // the outer dispatch ran
    expect(inner).toHaveLength(0); // the nested pass was suppressed by the cascade cap
  });
});
