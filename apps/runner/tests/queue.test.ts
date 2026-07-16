import { consumeExecutionBatch } from '../src/queue';
import type { ExecutionMessage } from '../src/protocol';
import { describe, expect, it, vi } from 'vitest';

function queueMessage(body: ExecutionMessage, attempts = 1) {
  return {
    id: `message-${String(attempts)}`,
    timestamp: new Date('2026-07-16T12:00:00.000Z'),
    body,
    attempts,
    ack: vi.fn(),
    retry: vi.fn(),
  };
}

describe('Queue to Workflow bridge', () => {
  it('acknowledges duplicate delivery after resolving the existing deterministic Workflow', async () => {
    const body = {
      sessionId: '01SESSION',
      generation: 2,
      workflowId: '01SESSION:2',
    } as const;
    const message = queueMessage(body);
    const existing = {
      status: vi.fn().mockResolvedValue({ status: 'running' }),
      restart: vi.fn(),
    };
    const workflow = {
      create: vi.fn().mockRejectedValue(new Error('instance already exists')),
      get: vi.fn().mockResolvedValue(existing),
    };

    await consumeExecutionBatch([message], workflow);

    expect(workflow.create).toHaveBeenCalledWith({ id: body.workflowId, params: body });
    expect(workflow.get).toHaveBeenCalledWith(body.workflowId);
    expect(message.ack).toHaveBeenCalledOnce();
    expect(message.retry).not.toHaveBeenCalled();
  });

  it.each(['errored', 'terminated'])(
    'restarts a %s deterministic Workflow before acknowledging',
    async (status) => {
      const body = {
        sessionId: '01SESSION',
        generation: 2,
        workflowId: '01SESSION:2',
      } as const;
      const message = queueMessage(body);
      const existing = {
        status: vi.fn().mockResolvedValue({ status }),
        restart: vi.fn().mockResolvedValue(undefined),
      };
      const workflow = {
        create: vi.fn().mockRejectedValue(new Error('instance already exists')),
        get: vi.fn().mockResolvedValue(existing),
      };

      await consumeExecutionBatch([message], workflow);

      expect(existing.restart).toHaveBeenCalledOnce();
      expect(message.ack).toHaveBeenCalledOnce();
      expect(message.retry).not.toHaveBeenCalled();
    },
  );

  it('retries when a terminal Workflow cannot be restarted', async () => {
    const body = {
      sessionId: '01SESSION',
      generation: 2,
      workflowId: '01SESSION:2',
    } as const;
    const message = queueMessage(body, 2);
    const existing = {
      status: vi.fn().mockResolvedValue({ status: 'errored' }),
      restart: vi.fn().mockRejectedValue(new Error('restart unavailable')),
    };
    const workflow = {
      create: vi.fn().mockRejectedValue(new Error('instance already exists')),
      get: vi.fn().mockResolvedValue(existing),
    };

    await consumeExecutionBatch([message], workflow);

    expect(message.retry).toHaveBeenCalledWith({ delaySeconds: 60 });
    expect(message.ack).not.toHaveBeenCalled();
  });

  it('retries a transient creation failure with bounded exponential backoff', async () => {
    const body = {
      sessionId: '01SESSION',
      generation: 3,
      workflowId: '01SESSION:3',
    } as const;
    const message = queueMessage(body, 3);
    const workflow = {
      create: vi.fn().mockRejectedValue(new Error('temporarily unavailable')),
      get: vi.fn().mockRejectedValue(new Error('not found')),
    };

    await consumeExecutionBatch([message], workflow);

    expect(message.retry).toHaveBeenCalledWith({ delaySeconds: 120 });
    expect(message.ack).not.toHaveBeenCalled();
  });
});
