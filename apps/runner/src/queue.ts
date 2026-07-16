import { isExecutionMessage, type ExecutionMessage } from './protocol';

/** Minimal Workflow instance surface required to resolve idempotent create conflicts. */
export interface ExistingWorkflowInstance {
  readonly status: () => Promise<{ readonly status: string }>;
}

/** Minimal generated Workflow binding surface used by the Queue consumer. */
export interface ExecutionWorkflowBinding {
  readonly create: (options: {
    readonly id: string;
    readonly params: ExecutionMessage;
  }) => Promise<unknown>;
  readonly get: (id: string) => Promise<ExistingWorkflowInstance>;
}

/** Queue message behavior used by the per-message retry-safe consumer. */
export interface ExecutionQueueMessage {
  readonly body: unknown;
  readonly attempts: number;
  readonly ack: () => void;
  readonly retry: (options?: { readonly delaySeconds?: number }) => void;
}

/** Compute capped exponential retry delay from the delivery attempt number. */
export function queueRetryDelay(attempts: number): number {
  return Math.min(30 * 2 ** Math.max(0, attempts - 1), 86_400);
}

/**
 * Create or resolve one deterministic Workflow for every Queue message.
 *
 * @remarks
 * Every message is handled independently so one failure never retries an already-acknowledged
 * batch peer. A create error is considered an idempotent duplicate only when the existing
 * instance can be read and has a known status; otherwise the message is explicitly retried.
 */
export async function consumeExecutionBatch(
  messages: readonly ExecutionQueueMessage[],
  workflow: ExecutionWorkflowBinding,
): Promise<void> {
  for (const message of messages) {
    if (!isExecutionMessage(message.body)) {
      console.error(JSON.stringify({ event: 'athena_queue_invalid_message' }));
      message.ack();
      continue;
    }
    try {
      await workflow.create({ id: message.body.workflowId, params: message.body });
      message.ack();
    } catch (createError) {
      try {
        const existing = await workflow.get(message.body.workflowId);
        const status = await existing.status();
        if (status.status === 'unknown') throw createError;
        message.ack();
      } catch {
        message.retry({ delaySeconds: queueRetryDelay(message.attempts) });
      }
    }
  }
}
