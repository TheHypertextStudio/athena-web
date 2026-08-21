import { describe, expect, it } from 'vitest';
import type { z } from 'zod';

import type { TaskWorkViewQueryRequest } from '@docket/types';

import { ApiError } from '../../src/error';
import {
  decodeWorkViewCursor,
  encodeWorkViewCursor,
  fingerprintWorkViewQuery,
} from '../../src/lib/work-views/cursor';

type TaskQueryRequest = z.infer<typeof TaskWorkViewQueryRequest>;

process.env['BETTER_AUTH_SECRET'] ??= 'work-view-cursor-test-secret-at-least-32-characters';

const execution = {
  organizationId: 'org_01',
  actorId: 'actor_01',
  userId: 'user_01',
  timeZone: 'America/Los_Angeles',
  asOf: '2026-08-20T16:00:00.000Z',
} as const;

const request: TaskQueryRequest = {
  target: 'task',
  definition: {
    version: 2,
    target: 'task',
    filter: { kind: 'predicate', field: 'priority', operator: 'is', operand: 'urgent' },
    arrangement: {
      groupBy: 'status',
      subGroupBy: null,
      orderBy: [{ field: 'dueDate', direction: 'asc' }],
    },
    presentation: {
      layout: 'list',
      properties: ['status', 'priority'],
      density: 'comfortable',
      showEmptyGroups: false,
    },
  },
  temporaryFilter: null,
  context: { kind: 'organization' },
  limit: 25,
};

describe('work-view cursors', () => {
  it('binds the canonical query, group path, ordered sort tuple, and entity id', () => {
    const fingerprint = fingerprintWorkViewQuery<'task'>(request, execution);
    const cursor = encodeWorkViewCursor<'task'>({
      fingerprint,
      groupPath: ['started'],
      sortTuple: [null, '2026-08-20T19:00:00.000Z'],
      entityId: 'task_02',
      asOf: execution.asOf,
    });

    expect(decodeWorkViewCursor(cursor, fingerprint)).toEqual({
      fingerprint,
      groupPath: ['started'],
      sortTuple: [null, '2026-08-20T19:00:00.000Z'],
      entityId: 'task_02',
      asOf: execution.asOf,
    });
  });

  it('rejects a valid cursor produced for another canonical query', () => {
    const fingerprint = fingerprintWorkViewQuery<'task'>(request, execution);
    const cursor = encodeWorkViewCursor<'task'>({
      fingerprint,
      groupPath: [],
      sortTuple: ['urgent'],
      entityId: 'task_02',
      asOf: execution.asOf,
    });
    const changed = fingerprintWorkViewQuery<'task'>(
      {
        ...request,
        definition: {
          ...request.definition,
          filter: { kind: 'predicate', field: 'priority', operator: 'is', operand: 'high' },
        },
      },
      execution,
    );

    expect(() => decodeWorkViewCursor(cursor, changed)).toThrow(ApiError);
    expect(() => decodeWorkViewCursor(cursor, changed)).toThrow(
      'This page cursor belongs to another view query',
    );
  });

  it('rejects a cursor produced for another group path', () => {
    const fingerprint = fingerprintWorkViewQuery<'task'>(request, execution);
    const cursor = encodeWorkViewCursor<'task'>({
      fingerprint,
      groupPath: ['started'],
      sortTuple: ['urgent'],
      entityId: 'task_02',
      asOf: execution.asOf,
    });

    expect(() => decodeWorkViewCursor(cursor, fingerprint, ['todo'])).toThrow(ApiError);
    expect(() => decodeWorkViewCursor(cursor, fingerprint, ['todo'])).toThrow(
      'This page cursor belongs to another group',
    );
  });

  it('rejects malformed cursor data instead of restarting at the first page', () => {
    const fingerprint = fingerprintWorkViewQuery<'task'>(request, execution);

    expect(() => decodeWorkViewCursor('wv2:not-json', fingerprint)).toThrow(ApiError);
  });

  it('fingerprints equivalent object key order identically and excludes the page cursor', () => {
    const fingerprint = fingerprintWorkViewQuery<'task'>(request, execution);
    const withCursor = { ...request, cursor: 'wv2:aaaaaaaa' as TaskQueryRequest['cursor'] };

    expect(fingerprintWorkViewQuery(withCursor, execution)).toBe(fingerprint);
  });

  it('fingerprints equivalent boolean-filter order as one canonical query', () => {
    const children = [
      { kind: 'predicate', field: 'priority', operator: 'is', operand: 'urgent' },
      { kind: 'predicate', field: 'archived', operator: 'is', operand: false },
    ] as const;
    const left: TaskQueryRequest = {
      ...request,
      definition: {
        ...request.definition,
        filter: {
          kind: 'all',
          children,
        },
      },
    };
    const right: TaskQueryRequest = {
      ...left,
      definition: {
        ...left.definition,
        filter: {
          kind: 'all',
          children: [children[1], children[0]],
        },
      },
    };

    expect(fingerprintWorkViewQuery<'task'>(left, execution)).toBe(
      fingerprintWorkViewQuery<'task'>(right, execution),
    );
  });

  it('binds organization, actor, user, timezone, and frozen time into execution identity', () => {
    const fingerprint = fingerprintWorkViewQuery<'task'>(request, execution);
    for (const changed of [
      { ...execution, organizationId: 'org_02' },
      { ...execution, actorId: 'actor_02' },
      { ...execution, userId: 'user_02' },
      { ...execution, timeZone: 'UTC' },
      { ...execution, asOf: '2026-08-20T16:00:01.000Z' },
    ]) {
      expect(fingerprintWorkViewQuery<'task'>(request, changed)).not.toBe(fingerprint);
    }
  });

  it('rejects a cursor whose signed payload was changed', () => {
    const fingerprint = fingerprintWorkViewQuery<'task'>(request, execution);
    const cursor = encodeWorkViewCursor<'task'>({
      fingerprint,
      groupPath: [],
      sortTuple: ['urgent'],
      entityId: 'task_02',
      asOf: execution.asOf,
    });
    const envelope = JSON.parse(Buffer.from(cursor.slice(4), 'base64url').toString('utf8')) as {
      payload: { entityId: string };
    };
    envelope.payload.entityId = 'task_tampered';
    const tampered = `wv2:${Buffer.from(JSON.stringify(envelope)).toString('base64url')}`;

    expect(() => decodeWorkViewCursor(tampered, fingerprint)).toThrow(ApiError);
  });
});
