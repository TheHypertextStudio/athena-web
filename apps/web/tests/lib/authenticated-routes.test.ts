import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  TaskNavigationSnapshot,
  type OrganizationId,
  type ProjectId,
  type TaskId,
} from '@docket/types';

import {
  buildAuthenticatedHref,
  buildEntityHref,
  parseAuthenticatedRoute,
  type AuthenticatedRouteParams,
} from '@/lib/authenticated-route';

const ORG_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAV' as OrganizationId;
const TASK_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAW' as TaskId;

describe('authenticated route contracts', () => {
  it('builds an entity href from branded parameters', () => {
    const href = buildAuthenticatedHref('/orgs/[orgId]/tasks/[taskId]', {
      orgId: ORG_ID,
      taskId: TASK_ID,
    });

    expect(href).toBe(`/orgs/${ORG_ID}/tasks/${TASK_ID}`);
  });

  it('infers each parameter brand from the generated pattern', () => {
    type Params = AuthenticatedRouteParams<'/orgs/[orgId]/projects/[projectId]'>;

    expectTypeOf<Params>().toEqualTypeOf<{
      readonly orgId: OrganizationId;
      readonly projectId: ProjectId;
    }>();
  });

  it('parses a path into one validated generated route', () => {
    const result = parseAuthenticatedRoute(`/orgs/${ORG_ID}/tasks/${TASK_ID}`);

    expect(result).toEqual({
      kind: 'matched',
      route: {
        pattern: '/orgs/[orgId]/tasks/[taskId]',
        params: { orgId: ORG_ID, taskId: TASK_ID },
      },
    });
  });

  it('distinguishes an invalid parameter from an unmatched route', () => {
    expect(parseAuthenticatedRoute('/orgs/not-an-id/tasks/also-bad')).toEqual({
      kind: 'invalid',
      pattern: '/orgs/[orgId]/tasks/[taskId]',
    });
    expect(parseAuthenticatedRoute('/not-an-authenticated-route')).toEqual({ kind: 'unmatched' });
  });

  it('refuses to build a path when runtime input bypasses TypeScript', () => {
    expect(() =>
      buildAuthenticatedHref('/orgs/[orgId]/tasks/[taskId]', {
        orgId: 'not-an-id' as OrganizationId,
        taskId: TASK_ID,
      }),
    ).toThrow();
  });

  it('derives the only valid detail route from an entity snapshot', () => {
    const snapshot = TaskNavigationSnapshot.parse({
      target: 'task',
      organizationId: ORG_ID,
      id: TASK_ID,
      title: 'Publish rider guide',
      status: 'started',
      priority: 'high',
      updatedAt: '2026-08-23T12:00:00.000Z',
    });

    expect(buildEntityHref(snapshot)).toBe(`/orgs/${ORG_ID}/tasks/${TASK_ID}`);
  });
});
