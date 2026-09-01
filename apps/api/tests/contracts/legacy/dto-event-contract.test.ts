/**
 * The event/observability contract every producer shares.
 *
 * @remarks
 * These tests guard the properties the contract *promises*, not the literal spelling of its
 * values: that the five reporting features have a kind to emit, that each typed detail arm
 * accepts what its producer sends and rejects what it must not, that an unmapped event still
 * degrades to `generic` instead of vanishing, and that the closed unions stay closed.
 */
import { describe, expect, it } from 'vitest';

import {
  AGENT_EVENT_KINDS,
  CanonicalEntityKind,
  DOCKET_ENTITY_KIND,
  ELICITATION_EVENT_KINDS,
  EventDetail,
  EventKind,
  PERSONAL_EVENT_KINDS,
  TIMER_EVENT_KINDS,
} from '@docket/connections/event-contract';
import { StreamRelevance } from '../../../src/contracts/stream';

describe('event kind taxonomy', () => {
  it('carries a verb for every observable timer transition', () => {
    expect([...TIMER_EVENT_KINDS]).toEqual([
      'timer_started',
      'timer_paused',
      'timer_resumed',
      'timer_switched',
      'timer_stopped',
    ]);
    for (const kind of TIMER_EVENT_KINDS) expect(EventKind.parse(kind)).toBe(kind);
  });

  it('distinguishes an answered question from one that timed out', () => {
    expect([...ELICITATION_EVENT_KINDS]).toEqual([
      'elicitation_requested',
      'elicitation_answered',
      'elicitation_expired',
    ]);
    for (const kind of ELICITATION_EVENT_KINDS) expect(EventKind.parse(kind)).toBe(kind);
  });

  it('gives every independently running agent the same five milestones', () => {
    expect([...AGENT_EVENT_KINDS]).toEqual([
      'agent_started',
      'agent_progress',
      'agent_blocked',
      'agent_completed',
      'agent_failed',
    ]);
    for (const kind of AGENT_EVENT_KINDS) expect(EventKind.parse(kind)).toBe(kind);
  });

  it('has a kind for inbound mail and for a metadata edit', () => {
    expect(EventKind.parse('email_received')).toBe('email_received');
    expect(EventKind.parse('field_change')).toBe('field_change');
  });

  it('stays closed — an invented verb is rejected', () => {
    expect(EventKind.safeParse('timer_restarted').success).toBe(false);
    expect(EventKind.safeParse('agent_thinking').success).toBe(false);
  });

  it('treats tracking, and only tracking, as personal', () => {
    expect([...PERSONAL_EVENT_KINDS]).toEqual([...TIMER_EVENT_KINDS]);
  });
});

describe('canonical subjects', () => {
  it("makes an agent's run a first-class subject", () => {
    expect(CanonicalEntityKind.parse('agent_session')).toBe('agent_session');
    expect(DOCKET_ENTITY_KIND['agent_session']).toBe('agent_session');
  });

  it('maps a received message onto the cross-tool `message` kind', () => {
    expect(DOCKET_ENTITY_KIND['inbound_message']).toBe('message');
  });

  it('leaves a Time Record unmapped, so tracking carries no routable subject of its own', () => {
    expect(DOCKET_ENTITY_KIND['time_record']).toBeUndefined();
  });
});

describe('stream relevance', () => {
  it('can say that work has halted until this person acts', () => {
    expect(StreamRelevance.parse('awaiting_you')).toBe('awaiting_you');
  });
});

describe('EventDetail arms', () => {
  it('accepts a timer switch carrying the record it moved off', () => {
    const parsed = EventDetail.parse({
      schema: 'docket.timer',
      timeRecordId: 'tr_2',
      previousTimeRecordId: 'tr_1',
      elapsedMs: 0,
      trackedLabel: 'Ship the beta',
    });
    expect(parsed).toMatchObject({ schema: 'docket.timer', previousTimeRecordId: 'tr_1' });
  });

  it('rejects negative elapsed time', () => {
    expect(
      EventDetail.safeParse({
        schema: 'docket.timer',
        timeRecordId: 'tr_1',
        previousTimeRecordId: null,
        elapsedMs: -1,
        trackedLabel: 'Ship the beta',
      }).success,
    ).toBe(false);
  });

  it('ties a received message to what it became', () => {
    const parsed = EventDetail.parse({
      schema: 'docket.inbound_email',
      messageId: '<abc@mail>',
      threadId: null,
      fromAddress: 'dani@example.com',
      fromName: 'Dani',
      subject: 'Q3 budget',
      snippet: 'Can you look at',
      hasAttachments: false,
      capturedEntityKind: 'work_item',
      capturedEntityId: 'task_1',
    });
    expect(parsed).toMatchObject({ capturedEntityKind: 'work_item', capturedEntityId: 'task_1' });
  });

  it('keeps a human answer and a timed-out auto-resolution in separate fields', () => {
    const answered = EventDetail.parse({
      schema: 'docket.elicitation',
      elicitationId: 'sa_1',
      sessionId: 'sess_1',
      question: 'Which workspace should this land in?',
      answer: 'Acme',
      autoResolvedValue: null,
      expiresAt: null,
    });
    const expired = EventDetail.parse({
      schema: 'docket.elicitation',
      elicitationId: 'sa_1',
      sessionId: 'sess_1',
      question: 'Which workspace should this land in?',
      answer: null,
      autoResolvedValue: 'Acme',
      expiresAt: '2026-08-02T12:00:00.000Z',
    });
    expect(answered).toMatchObject({ answer: 'Acme', autoResolvedValue: null });
    expect(expired).toMatchObject({ answer: null, autoResolvedValue: 'Acme' });
  });

  it('accepts a subagent milestone and bounds self-reported progress', () => {
    const parsed = EventDetail.parse({
      schema: 'docket.agent_milestone',
      sessionId: 'sess_2',
      executionId: 'exec_1',
      parentSessionId: 'sess_1',
      agentName: 'Research subagent',
      milestone: 'Read the last four incident reports',
      progress: 40,
      reasonCode: null,
    });
    expect(parsed).toMatchObject({ parentSessionId: 'sess_1', progress: 40 });
    expect(
      EventDetail.safeParse({
        schema: 'docket.agent_milestone',
        sessionId: 'sess_2',
        executionId: null,
        parentSessionId: null,
        agentName: 'Athena',
        milestone: 'Done',
        progress: 140,
        reasonCode: null,
      }).success,
    ).toBe(false);
  });

  it('carries a whole edit in one detail, with machine keys for predicates', () => {
    const parsed = EventDetail.parse({
      schema: 'docket.field_change',
      changes: [
        { field: 'dueDate', label: 'Due', from: null, to: 'Aug 14' },
        { field: 'projectId', label: 'Project', from: 'Inbox', to: 'Website redesign' },
      ],
      fields: ['dueDate', 'projectId'],
    });
    expect(parsed).toMatchObject({ fields: ['dueDate', 'projectId'] });
  });

  it('rejects a field change that changed nothing', () => {
    expect(
      EventDetail.safeParse({ schema: 'docket.field_change', changes: [], fields: [] }).success,
    ).toBe(false);
  });

  it('still surfaces an unmapped event through the generic escape', () => {
    const parsed = EventDetail.parse({
      schema: 'generic',
      title: 'Something a future tool did',
      summary: null,
      url: null,
    });
    expect(parsed.schema).toBe('generic');
    expect(EventDetail.safeParse({ schema: 'docket.something_invented' }).success).toBe(false);
  });
});
