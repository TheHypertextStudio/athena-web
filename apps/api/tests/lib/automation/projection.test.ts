import { describe, expect, it } from 'vitest';

import { projectEmitInput, projectInboundDraft } from '../../../src/lib/automation/event';

const occurredAt = new Date('2026-07-01T12:00:00Z');

describe('projectEmitInput (internal emit → engine shape)', () => {
  it('projects subject, kind, actor, detail, and the mapped canonical entity kind', () => {
    const projected = projectEmitInput(
      {
        organizationId: 'org1',
        kind: 'completed',
        title: 'Ship the beta',
        actorId: 'actor1',
        subject: { type: 'task', id: 'task1', title: 'Ship the beta' },
        detail: { schema: 'docket.state_change', fromState: 'in_progress', toState: 'done' },
      },
      occurredAt,
    );
    expect(projected).toEqual({
      organizationId: 'org1',
      kind: 'completed',
      source: 'docket',
      subjectType: 'task',
      subjectId: 'task1',
      entityKind: 'work_item',
      subjectTitle: 'Ship the beta',
      detail: { schema: 'docket.state_change', fromState: 'in_progress', toState: 'done' },
      actorId: 'actor1',
      occurredAt,
    });
  });

  it('omits entityKind for subjects without a canonical kind and flattens absent detail to {}', () => {
    const projected = projectEmitInput(
      {
        organizationId: 'org1',
        kind: 'created',
        title: 'Reply to recruiter',
        subject: { type: 'email_suggestion', id: 'sugg1' },
      },
      occurredAt,
    );
    expect(projected.entityKind).toBeUndefined();
    expect(projected.subjectTitle).toBeUndefined();
    expect(projected.actorId).toBeUndefined();
    expect(projected.detail).toEqual({});
  });
});

describe('projectInboundDraft (external drain → engine shape)', () => {
  it('addresses an unresolved external event via source/entityKind only', () => {
    const projected = projectInboundDraft({
      organizationId: 'org1',
      kind: 'mention',
      source: 'linear',
      entityKind: 'work_item',
      docketEntityId: null,
      title: 'You were mentioned',
      detail: { schema: 'linear.issue', stateName: 'Todo', priority: 2 },
      occurredAt,
    });
    expect(projected).toEqual({
      organizationId: 'org1',
      kind: 'mention',
      source: 'linear',
      entityKind: 'work_item',
      subjectTitle: 'You were mentioned',
      detail: { schema: 'linear.issue', stateName: 'Todo', priority: 2 },
      occurredAt,
    });
    expect(projected.subjectType).toBeUndefined();
    expect(projected.subjectId).toBeUndefined();
  });

  it('reverse-maps a resolved entity to its Docket subject type', () => {
    const projected = projectInboundDraft({
      organizationId: 'org1',
      kind: 'completed',
      source: 'linear',
      entityKind: 'work_item',
      docketEntityId: 'task1',
      title: 'LIN-42',
      detail: null,
      occurredAt,
    });
    expect(projected.subjectType).toBe('task');
    expect(projected.subjectId).toBe('task1');
    expect(projected.detail).toEqual({});
  });

  it('omits entityKind when the draft carried none and never fabricates detail', () => {
    const projected = projectInboundDraft({
      organizationId: 'org1',
      kind: 'message',
      source: 'slack',
      entityKind: null,
      docketEntityId: null,
      title: 'hello',
      detail: 'not-an-object',
      occurredAt,
    });
    expect(projected.entityKind).toBeUndefined();
    expect(projected.detail).toEqual({});
  });
});
