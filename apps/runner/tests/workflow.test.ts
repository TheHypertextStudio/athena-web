import {
  advanceDocket,
  DEFAULT_GENERATION_REQUEST_TIMEOUT_MS,
  executeGenerationWorkflow,
  type GenerationWorkflowStep,
} from '../src/workflow';
import type { ExecutionMessage } from '../src/protocol';
import { describe, expect, it, vi } from 'vitest';

const message: ExecutionMessage = {
  sessionId: '01SESSION',
  generation: 4,
  workflowId: '01SESSION:4',
};

describe('durable generation Workflow', () => {
  it('allows a bounded generation substantially longer than the former ten-second deadline', () => {
    expect(DEFAULT_GENERATION_REQUEST_TIMEOUT_MS).toBeGreaterThanOrEqual(15 * 60_000);
  });

  it('aborts a stalled Workflow-to-Docket advance at the configured deadline', async () => {
    const fetch = vi.fn(
      async (_input: URL | RequestInfo, init?: RequestInit): Promise<Response> =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new Error('aborted', { cause: init.signal?.reason }));
          });
        }),
    );

    await expect(
      advanceDocket(
        {
          DOCKET_API_URL: 'https://api.example',
          CLOUDFLARE_TO_DOCKET_HMAC_SECRET: 'cloudflare-to-docket-secret',
        },
        message,
        'run',
        { fetch, timeoutMs: 1 },
      ),
    ).rejects.toThrow(/advance timed out/i);
    expect((fetch.mock.calls[0]?.[1]?.signal as AbortSignal | undefined)?.aborted).toBe(true);
  });

  it('waits through yearly epochs without a product duration cap and dispatches the next generation', async () => {
    const waitForEvent = vi
      .fn()
      .mockRejectedValueOnce(
        Object.assign(new Error('waitForEvent timed out'), { name: 'TimeoutError' }),
      )
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

  it('surfaces non-timeout wait failures instead of entering another wait epoch', async () => {
    const failure = new Error('workflow storage unavailable');
    const waitForEvent = vi.fn().mockRejectedValueOnce(failure).mockResolvedValueOnce({});
    const step: GenerationWorkflowStep = {
      async do<T>(_name: string, callback: () => Promise<T>): Promise<T> {
        return callback();
      },
      waitForEvent,
    };
    const advance = vi
      .fn()
      .mockResolvedValueOnce({ state: 'wait' })
      .mockResolvedValueOnce({ state: 'complete' });

    await expect(
      executeGenerationWorkflow(message, step, { advance, dispatch: vi.fn() }),
    ).rejects.toBe(failure);
    expect(waitForEvent).toHaveBeenCalledOnce();
    expect(advance).toHaveBeenCalledOnce();
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
