import { executeGenerationWorkflow, type GenerationWorkflowStep } from '../src/workflow';
import type { ExecutionMessage } from '../src/protocol';
import { describe, expect, it, vi } from 'vitest';

const message: ExecutionMessage = {
  sessionId: '01SESSION',
  generation: 4,
  workflowId: '01SESSION:4',
};

describe('durable generation Workflow', () => {
  it('waits through yearly epochs without a product duration cap and dispatches the next generation', async () => {
    const waitForEvent = vi
      .fn()
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce({ payload: { wakeId: 'wake-1' } });
    const doStep = vi.fn();
    const step: GenerationWorkflowStep = {
      async do<T>(name: string, callback: () => Promise<T>): Promise<T> {
        doStep(name);
        return callback();
      },
      waitForEvent,
    };
    const next: ExecutionMessage = {
      sessionId: '01SESSION',
      generation: 5,
      workflowId: '01SESSION:5',
    };
    const advance = vi
      .fn()
      .mockResolvedValueOnce({ state: 'wait' })
      .mockResolvedValueOnce({ state: 'continue', next });
    const dispatch = vi.fn().mockResolvedValue(undefined);

    await executeGenerationWorkflow(message, step, { advance, dispatch });

    expect(waitForEvent).toHaveBeenNthCalledWith(1, 'wait-for-wake-1', {
      type: 'docket_wake',
      timeout: '365 days',
    });
    expect(waitForEvent).toHaveBeenNthCalledWith(2, 'wait-for-wake-2', {
      type: 'docket_wake',
      timeout: '365 days',
    });
    expect(advance).toHaveBeenNthCalledWith(1, message, 'run');
    expect(advance).toHaveBeenNthCalledWith(2, message, 'wake');
    expect(dispatch).toHaveBeenCalledWith(next);
  });

  it('completes without dispatch when Docket reports a terminal generation', async () => {
    const doStep = vi.fn();
    const step: GenerationWorkflowStep = {
      async do<T>(name: string, callback: () => Promise<T>): Promise<T> {
        doStep(name);
        return callback();
      },
      waitForEvent: vi.fn(),
    };
    const dispatch = vi.fn();

    await executeGenerationWorkflow(message, step, {
      advance: vi.fn().mockResolvedValue({ state: 'complete' }),
      dispatch,
    });

    expect(step.waitForEvent).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
  });
});
