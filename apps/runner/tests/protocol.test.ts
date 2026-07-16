import { createExecutionMessage, isExecutionMessage, workflowIdFor } from '../src/protocol';
import { describe, expect, it } from 'vitest';

describe('opaque execution protocol', () => {
  it('derives the deterministic workflow id from only session and generation', () => {
    expect(workflowIdFor('01SESSION', 7)).toBe('01SESSION:7');
    expect(createExecutionMessage('01SESSION', 7)).toEqual({
      sessionId: '01SESSION',
      generation: 7,
      workflowId: '01SESSION:7',
    });
  });

  it('rejects messages carrying prompt, owner, credential, or extra payload fields', () => {
    expect(
      isExecutionMessage({
        sessionId: '01SESSION',
        generation: 1,
        workflowId: '01SESSION:1',
      }),
    ).toBe(true);
    expect(
      isExecutionMessage({
        sessionId: '01SESSION',
        generation: 1,
        workflowId: '01SESSION:1',
        prompt: 'private',
      }),
    ).toBe(false);
    expect(
      isExecutionMessage({
        sessionId: '01SESSION',
        generation: 1,
        workflowId: 'wrong',
      }),
    ).toBe(false);
  });
});
