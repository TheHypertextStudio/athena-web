import { describe, expect, it } from 'vitest';

import {
  ElicitationRequestSchema,
  elicitationAnswerSchema,
  elicitationFromMcpRequestedSchema,
} from '../src/elicitation';
import { ElicitationOut } from '../src/elicitation-api';

describe('Athena elicitation contract', () => {
  it('owns the request grammar, answer validator, MCP mapping, and delivery DTO', () => {
    const spec = elicitationFromMcpRequestedSchema({
      type: 'object',
      properties: { channel: { type: 'string', enum: ['team', 'project'] } },
      required: ['channel'],
    });

    expect(
      ElicitationRequestSchema.parse({
        question: 'Where should this update go?',
        actionSummary: 'Post the update to the selected channel.',
        spec,
        timeoutPolicy: 'ambiguous',
      }).spec,
    ).toEqual(spec);
    expect(elicitationAnswerSchema(spec).parse({ channel: 'team' })).toEqual({ channel: 'team' });
    expect(
      ElicitationOut.parse({
        id: 'elicitation_1',
        sessionId: 'session_1',
        task: { id: 'task_1', title: 'Ship update', href: '/tasks/task_1' },
        question: 'Where should this update go?',
        actionSummary: 'Post the update to the selected channel.',
        spec,
        status: 'pending',
        timeoutPolicy: 'ambiguous',
        timeSensitive: false,
        expiresAt: '2026-08-13T00:00:00.000Z',
        createdAt: '2026-08-13T00:00:00.000Z',
        settledAt: null,
        resolver: null,
        answer: null,
        autoResolveReason: null,
        live: false,
      }).spec,
    ).toEqual(spec);
  });
});
