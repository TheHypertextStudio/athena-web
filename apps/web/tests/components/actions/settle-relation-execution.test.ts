import { describe, expect, it, vi } from 'vitest';

import { settleRelationExecution } from '@/components/actions/settle-relation-execution';

describe('settleRelationExecution', () => {
  it('does not settle an applied relation until its projection repair finishes', async () => {
    let finishRepair: (() => void) | undefined;
    const repair = new Promise<void>((resolve) => {
      finishRepair = resolve;
    });
    let settled = false;

    const execution = settleRelationExecution(
      vi.fn(async () => ({ status: 'applied' as const })),
      vi.fn(() => repair),
    ).then(() => {
      settled = true;
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(settled).toBe(false);
    finishRepair?.();
    await execution;
    expect(settled).toBe(true);
  });

  it('preserves a write failure after waiting for a failed repair attempt', async () => {
    const writeError = new Error('write failed');
    let finishRepair: (() => void) | undefined;
    const repair = new Promise<void>((_resolve, reject) => {
      finishRepair = () => {
        reject(new Error('repair failed'));
      };
    });
    let settled = false;

    const execution = settleRelationExecution(
      vi.fn(async () => Promise.reject(writeError)),
      vi.fn(() => repair),
    ).catch((error: unknown) => {
      settled = true;
      throw error;
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(settled).toBe(false);
    finishRepair?.();
    await expect(execution).rejects.toBe(writeError);
  });
});
