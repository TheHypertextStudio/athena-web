import type { agentSession } from '@docket/db';
import { describe, expect, it, vi } from 'vitest';

import { advanceCloudflareGeneration } from '../../src/agent/execution-advance';
import type { RunGenerationMessage } from '../../src/agent/run-generation';
import { ConflictError } from '../../src/error';
import { assertDefined } from '@docket/test-utils';

const message: RunGenerationMessage = {
  sessionId: '01SESSION',
  generation: 3,
  workflowId: '01SESSION:3',
};
const session = {
  id: message.sessionId,
  executorKind: 'athena',
  status: 'running',
  contextOrganizationId: null,
  organizationId: null,
} as typeof agentSession.$inferSelect;
const lease = {
  runId: '01RUN',
  sessionId: message.sessionId,
  generation: message.generation,
  leaseToken: 'lease-token',
  leaseDurationMs: 60_000,
};

describe('Cloudflare generation advance', () => {
  it('claims and executes one quantum before persisting the next generation', async () => {
    const next = {
      runId: '01NEXT',
      message: { sessionId: '01SESSION', generation: 4, workflowId: '01SESSION:4' },
    } as const;
    const enqueue = vi.fn().mockResolvedValue(next);
    const drive = vi.fn().mockResolvedValue({ ...session, status: 'running' });

    await expect(
      advanceCloudflareGeneration(message, 'run', {
        claim: vi.fn().mockResolvedValue({ session, lease }),
        drive,
        enqueue,
        loadWaiting: vi.fn(),
      }),
    ).resolves.toEqual({ state: 'continue', next: next.message });
    expect(drive.mock.invocationCallOrder[0]).toBeLessThan(
      assertDefined(enqueue.mock.invocationCallOrder[0]),
    );
  });

  it('durably waits without creating another generation', async () => {
    const enqueue = vi.fn();

    await expect(
      advanceCloudflareGeneration(message, 'run', {
        claim: vi.fn().mockResolvedValue({ session, lease }),
        drive: vi.fn().mockResolvedValue({ ...session, status: 'awaiting_input' }),
        enqueue,
        loadWaiting: vi.fn(),
      }),
    ).resolves.toEqual({ state: 'wait' });
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('turns a persisted human wake into the next queued generation', async () => {
    const next = {
      runId: '01NEXT',
      message: { sessionId: '01SESSION', generation: 4, workflowId: '01SESSION:4' },
    } as const;
    const enqueue = vi.fn().mockResolvedValue(next);

    await expect(
      advanceCloudflareGeneration(message, 'wake', {
        claim: vi.fn(),
        drive: vi.fn(),
        enqueue,
        loadWaiting: vi.fn().mockResolvedValue({ ...session, status: 'awaiting_input' }),
      }),
    ).resolves.toEqual({ state: 'continue', next: next.message });
    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ id: message.sessionId }),
      expect.objectContaining({ runnableStatuses: ['awaiting_input', 'awaiting_approval'] }),
    );
  });

  it('returns the persisted outcome when Cloudflare retries after losing the response', async () => {
    const recovered = {
      state: 'continue' as const,
      next: { sessionId: '01SESSION', generation: 4, workflowId: '01SESSION:4' },
    };

    await expect(
      advanceCloudflareGeneration(message, 'run', {
        claim: vi.fn().mockRejectedValue(new ConflictError('already settled')),
        drive: vi.fn(),
        enqueue: vi.fn(),
        loadWaiting: vi.fn(),
        recover: vi.fn().mockResolvedValue(recovered),
      }),
    ).resolves.toEqual(recovered);
  });

  it.each(['failed', 'completed', 'canceled'] as const)(
    'reports a %s wake target without enqueuing another generation',
    async (status) => {
      const enqueue = vi.fn();
      const expected = status === 'failed' ? { state: 'failed' } : { state: 'complete' };
      await expect(
        advanceCloudflareGeneration(message, 'wake', {
          claim: vi.fn(),
          drive: vi.fn(),
          enqueue,
          loadWaiting: vi.fn().mockResolvedValue({ ...session, status }),
        }),
      ).resolves.toEqual(expected);
      expect(enqueue).not.toHaveBeenCalled();
    },
  );

  it('refuses to wake a session that is not actually waiting for a person', async () => {
    await expect(
      advanceCloudflareGeneration(message, 'wake', {
        claim: vi.fn(),
        drive: vi.fn(),
        enqueue: vi.fn(),
        loadWaiting: vi.fn().mockResolvedValue({ ...session, status: 'running' }),
      }),
    ).rejects.toThrow('Session is not waiting for a person');
  });

  it('propagates a claim failure unchanged when it is not a ConflictError', async () => {
    const recover = vi.fn();
    await expect(
      advanceCloudflareGeneration(message, 'run', {
        claim: vi.fn().mockRejectedValue(new Error('database is unavailable')),
        drive: vi.fn(),
        enqueue: vi.fn(),
        loadWaiting: vi.fn(),
        recover,
      }),
    ).rejects.toThrow('database is unavailable');
    expect(recover).not.toHaveBeenCalled();
  });

  it('propagates the original conflict when there is no recovery dependency', async () => {
    await expect(
      advanceCloudflareGeneration(message, 'run', {
        claim: vi.fn().mockRejectedValue(new ConflictError('already settled')),
        drive: vi.fn(),
        enqueue: vi.fn(),
        loadWaiting: vi.fn(),
      }),
    ).rejects.toThrow('already settled');
  });

  it('propagates the original conflict when recovery finds nothing to report', async () => {
    await expect(
      advanceCloudflareGeneration(message, 'run', {
        claim: vi.fn().mockRejectedValue(new ConflictError('already settled')),
        drive: vi.fn(),
        enqueue: vi.fn(),
        loadWaiting: vi.fn(),
        recover: vi.fn().mockResolvedValue(null),
      }),
    ).rejects.toThrow('already settled');
  });

  it.each(['failed', 'completed', 'canceled'] as const)(
    'reports a %s outcome after driving the claimed quantum, without enqueuing another',
    async (status) => {
      const enqueue = vi.fn();
      const expected = status === 'failed' ? { state: 'failed' } : { state: 'complete' };
      await expect(
        advanceCloudflareGeneration(message, 'run', {
          claim: vi.fn().mockResolvedValue({ session, lease }),
          drive: vi.fn().mockResolvedValue({ ...session, status }),
          enqueue,
          loadWaiting: vi.fn(),
        }),
      ).resolves.toEqual(expected);
      expect(enqueue).not.toHaveBeenCalled();
    },
  );

  it('refuses an unsupported settled session state', async () => {
    await expect(
      advanceCloudflareGeneration(message, 'run', {
        claim: vi.fn().mockResolvedValue({ session, lease }),
        drive: vi.fn().mockResolvedValue({ ...session, status: 'pending' }),
        enqueue: vi.fn(),
        loadWaiting: vi.fn(),
      }),
    ).rejects.toThrow('Generation returned an unsupported session state');
  });

  it('drives with the context workspace when present, and the legacy workspace otherwise', async () => {
    const drive = vi.fn().mockResolvedValue({ ...session, status: 'running' });
    const enqueue = vi.fn().mockResolvedValue({
      runId: '01NEXT',
      message: { sessionId: '01SESSION', generation: 4, workflowId: '01SESSION:4' },
    });

    await advanceCloudflareGeneration(message, 'run', {
      claim: vi
        .fn()
        .mockResolvedValue({ session: { ...session, contextOrganizationId: 'org_ctx' }, lease }),
      drive,
      enqueue,
      loadWaiting: vi.fn(),
    });
    expect(drive).toHaveBeenCalledWith('org_ctx', message.sessionId, lease);

    drive.mockClear();
    await advanceCloudflareGeneration(message, 'run', {
      claim: vi.fn().mockResolvedValue({
        session: { ...session, contextOrganizationId: null, organizationId: 'org_legacy' },
        lease,
      }),
      drive,
      enqueue,
      loadWaiting: vi.fn(),
    });
    expect(drive).toHaveBeenCalledWith('org_legacy', message.sessionId, lease);
  });
});
