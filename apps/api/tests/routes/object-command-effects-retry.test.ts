import { beforeAll, describe, expect, it, vi } from 'vitest';
import { eq, inArray } from 'drizzle-orm';

import type * as DbModule from '@docket/db';

const { emitEvent, emitEventStrict } = vi.hoisted(() => ({
  emitEvent: vi.fn().mockResolvedValue(undefined),
  emitEventStrict: vi.fn().mockRejectedValue(new Error('event write unavailable')),
}));

vi.mock('../../src/routes/event-emit', () => ({ emitEvent, emitEventStrict }));

import { processObjectCommandEffectJobs } from '../../src/lib/object-command-effects';
import { getDb, seedTaskAccessOrg } from '../support/routes-harness';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
});

describe('object command effect retries', () => {
  it('keeps a strict event failure retryable instead of marking the job complete', async () => {
    const seeded = await seedTaskAccessOrg(db, schema, 'manage');
    const commandId = `retry-event-${seeded.orgId}`;
    await db.insert(schema.objectCommandEffectJob).values({
      organizationId: seeded.orgId,
      actorId: seeded.humanActorId,
      commandId,
      payload: {
        version: 1,
        organizationId: seeded.orgId,
        actorId: seeded.humanActorId,
        commandId,
        occurredAt: new Date().toISOString(),
        effects: [
          {
            kind: 'project_status',
            project: { id: 'project-1', name: 'Retry Project', status: 'active' },
          },
        ],
      },
    });

    expect(await processObjectCommandEffectJobs({ limit: 1 })).toEqual({
      processed: 1,
      succeeded: 0,
      failed: 1,
    });
    expect(emitEventStrict).toHaveBeenCalledOnce();
    expect(emitEvent).not.toHaveBeenCalled();
    expect(
      await db
        .select({
          status: schema.objectCommandEffectJob.status,
          attempts: schema.objectCommandEffectJob.attempts,
          nextEffect: schema.objectCommandEffectJob.nextEffect,
        })
        .from(schema.objectCommandEffectJob)
        .where(eq(schema.objectCommandEffectJob.commandId, commandId)),
    ).toEqual([{ status: 'failed', attempts: 1, nextEffect: 0 }]);
  });

  it('fails a persisted payload whose effect kind is unknown', async () => {
    const seeded = await seedTaskAccessOrg(db, schema, 'manage');
    const commandId = `invalid-effect-${seeded.orgId}`;
    await db.insert(schema.objectCommandEffectJob).values({
      organizationId: seeded.orgId,
      actorId: seeded.humanActorId,
      commandId,
      payload: {
        version: 1,
        organizationId: seeded.orgId,
        actorId: seeded.humanActorId,
        commandId,
        occurredAt: new Date().toISOString(),
        effects: [{ kind: 'unknown_effect' }],
      },
    });

    expect(await processObjectCommandEffectJobs({ limit: 1 })).toEqual({
      processed: 1,
      succeeded: 0,
      failed: 1,
    });
    expect(
      await db
        .select({ status: schema.objectCommandEffectJob.status })
        .from(schema.objectCommandEffectJob)
        .where(eq(schema.objectCommandEffectJob.commandId, commandId)),
    ).toEqual([{ status: 'failed' }]);
  });

  it('keeps corrupted persisted jobs retryable and records application-owned diagnostics', async () => {
    const seeded = await seedTaskAccessOrg(db, schema, 'manage');
    const now = new Date('2026-01-02T00:00:00.000Z');
    const cases: { readonly suffix: string; readonly payload: unknown; readonly error: string }[] =
      [
        { suffix: 'payload', payload: {}, error: 'Command effect payload is invalid' },
        {
          suffix: 'empty-effect',
          payload: {
            version: 1,
            organizationId: seeded.orgId,
            actorId: seeded.humanActorId,
            commandId: 'ignored-empty-effect',
            occurredAt: new Date().toISOString(),
            effects: [null],
          },
          error: 'Command effect payload contains an empty effect',
        },
        {
          suffix: 'time',
          payload: {
            version: 1,
            organizationId: seeded.orgId,
            actorId: seeded.humanActorId,
            commandId: 'ignored-time',
            occurredAt: 'not-a-time',
            effects: [{ kind: 'entity_write' }],
          },
          error: 'Command effect time is invalid',
        },
        {
          suffix: 'primitive-effect',
          payload: {
            version: 1,
            organizationId: seeded.orgId,
            actorId: seeded.humanActorId,
            commandId: 'ignored-primitive-effect',
            occurredAt: new Date().toISOString(),
            effects: [42],
          },
          error: 'Unsupported command effect',
        },
      ];
    const commandIds = cases.map(({ suffix }) => `corrupt-${suffix}-${seeded.orgId}`);
    await db.insert(schema.objectCommandEffectJob).values(
      cases.map(({ payload }, index) => ({
        organizationId: seeded.orgId,
        actorId: seeded.humanActorId,
        commandId: commandIds[index] ?? `corrupt-fallback-${index}`,
        payload,
        runAfter: new Date('2026-01-01T00:00:00.000Z'),
      })),
    );

    expect(await processObjectCommandEffectJobs({ now })).toEqual({
      processed: cases.length,
      succeeded: 0,
      failed: cases.length,
    });
    expect(
      await db
        .select({
          commandId: schema.objectCommandEffectJob.commandId,
          status: schema.objectCommandEffectJob.status,
          lastError: schema.objectCommandEffectJob.lastError,
        })
        .from(schema.objectCommandEffectJob)
        .where(inArray(schema.objectCommandEffectJob.commandId, commandIds)),
    ).toEqual(
      expect.arrayContaining(
        cases.map(({ error }, index) => ({
          commandId: commandIds[index],
          status: 'failed',
          lastError: error,
        })),
      ),
    );
  });

  it('normalizes a non-Error consequence failure before scheduling its retry', async () => {
    const seeded = await seedTaskAccessOrg(db, schema, 'manage');
    const commandId = `primitive-failure-${seeded.orgId}`;
    const now = new Date('2026-01-02T00:00:00.000Z');
    emitEventStrict.mockRejectedValueOnce('event write rejected');
    await db.insert(schema.objectCommandEffectJob).values({
      organizationId: seeded.orgId,
      actorId: seeded.humanActorId,
      commandId,
      runAfter: new Date('2026-01-01T00:00:00.000Z'),
      payload: {
        version: 1,
        organizationId: seeded.orgId,
        actorId: seeded.humanActorId,
        commandId,
        occurredAt: new Date().toISOString(),
        effects: [
          {
            kind: 'project_status',
            project: { id: 'project-primitive', name: 'Primitive failure', status: 'active' },
          },
        ],
      },
    });

    expect(await processObjectCommandEffectJobs({ limit: 1, now })).toEqual({
      processed: 1,
      succeeded: 0,
      failed: 1,
    });
    expect(
      await db
        .select({ lastError: schema.objectCommandEffectJob.lastError })
        .from(schema.objectCommandEffectJob)
        .where(eq(schema.objectCommandEffectJob.commandId, commandId)),
    ).toEqual([{ lastError: 'event write rejected' }]);
  });

  it('removes expired successful jobs without removing recent retry evidence', async () => {
    const seeded = await seedTaskAccessOrg(db, schema, 'manage');
    const now = new Date('2026-08-24T12:00:00.000Z');
    const expiredCommandId = `expired-effect-${seeded.orgId}`;
    const recentCommandId = `recent-effect-${seeded.orgId}`;
    await db.insert(schema.objectCommandEffectJob).values([
      {
        organizationId: seeded.orgId,
        actorId: seeded.humanActorId,
        commandId: expiredCommandId,
        payload: {
          version: 1,
          organizationId: seeded.orgId,
          actorId: seeded.humanActorId,
          commandId: expiredCommandId,
          occurredAt: new Date('2026-08-16T12:00:00.000Z').toISOString(),
          effects: [],
        },
        status: 'succeeded',
        processedAt: new Date('2026-08-16T12:00:00.000Z'),
      },
      {
        organizationId: seeded.orgId,
        actorId: seeded.humanActorId,
        commandId: recentCommandId,
        payload: {
          version: 1,
          organizationId: seeded.orgId,
          actorId: seeded.humanActorId,
          commandId: recentCommandId,
          occurredAt: new Date('2026-08-22T12:00:00.000Z').toISOString(),
          effects: [],
        },
        status: 'succeeded',
        processedAt: new Date('2026-08-22T12:00:00.000Z'),
      },
    ]);

    expect(await processObjectCommandEffectJobs({ limit: 0, now })).toEqual({
      processed: 0,
      succeeded: 0,
      failed: 0,
    });
    expect(
      await db
        .select({ commandId: schema.objectCommandEffectJob.commandId })
        .from(schema.objectCommandEffectJob)
        .where(
          inArray(schema.objectCommandEffectJob.commandId, [expiredCommandId, recentCommandId]),
        ),
    ).toEqual([{ commandId: recentCommandId }]);
  });
});
