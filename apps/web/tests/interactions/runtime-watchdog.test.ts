import { describe, expect, it, vi } from 'vitest';

import { createRuntimeWatchdog } from '@/lib/interactions/runtime-watchdog';

describe('runtime watchdog', () => {
  it('reports named unowned asynchronous work in test mode', () => {
    const report = vi.fn();
    const watchdog = createRuntimeWatchdog({ environment: 'test', onFailure: report });

    watchdog.observeAsync('task.complete', undefined);

    expect(report).toHaveBeenCalledWith({ code: 'unowned-async-work', actionId: 'task.complete' });
  });

  it('reports an owned interaction that never reaches painted acknowledgement', () => {
    const report = vi.fn();
    let scheduled: (() => void) | undefined;
    const watchdog = createRuntimeWatchdog({
      environment: 'test',
      onFailure: report,
      schedule: (callback) => {
        scheduled = callback;
        return 1;
      },
      clear: vi.fn(),
    });

    watchdog.observeAsync('task.complete', {
      invocationId: 'ephemeral-root-invocation',
      isAcknowledged: () => false,
    });
    scheduled?.();

    expect(report).toHaveBeenCalledWith({
      code: 'missing-painted-acknowledgement',
      actionId: 'task.complete',
    });
  });

  it('permits declared autonomous work and cleans up an acknowledged owner', () => {
    const report = vi.fn();
    const clear = vi.fn();
    const watchdog = createRuntimeWatchdog({
      environment: 'test',
      onFailure: report,
      schedule: () => 1,
      clear,
    });

    const autonomous = watchdog.observeAsync('task.revalidate', { autonomous: true });
    const owned = watchdog.observeAsync('task.complete', {
      invocationId: 'ephemeral-root-invocation',
      isAcknowledged: () => true,
    });
    autonomous.cleanup();
    owned.cleanup();

    expect(report).not.toHaveBeenCalled();
    expect(clear).toHaveBeenCalledTimes(1);
  });
});
