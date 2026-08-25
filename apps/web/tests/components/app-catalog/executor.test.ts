import { describe, expect, it, vi } from 'vitest';

import {
  executeCapabilityTarget,
  type CapabilityExecutor,
} from '@/components/app-catalog/executor';

function executor(): CapabilityExecutor {
  return {
    navigate: vi.fn(),
    openPanel: vi.fn(),
    openCreate: vi.fn(),
    createWorkspace: vi.fn(),
    cycleDensity: vi.fn(),
    signOut: vi.fn(),
  };
}

describe('executeCapabilityTarget', () => {
  it('executes routes and shell intents through one host boundary', () => {
    const host = executor();

    executeCapabilityTarget({ type: 'route', href: '/settings/security' }, host);
    executeCapabilityTarget(
      { type: 'intent', intent: { type: 'open-panel', panelId: 'focus' } },
      host,
    );
    executeCapabilityTarget(
      { type: 'intent', intent: { type: 'create', kind: 'task', templateId: 'template_1' } },
      host,
    );

    expect(host.navigate).toHaveBeenCalledWith('/settings/security');
    expect(host.openPanel).toHaveBeenCalledWith('focus');
    expect(host.openCreate).toHaveBeenCalledWith('task', 'template_1');
  });

  it('dispatches global action intents without exposing their callbacks to the catalog', () => {
    const host = executor();

    executeCapabilityTarget({ type: 'intent', intent: { type: 'create-workspace' } }, host);
    executeCapabilityTarget({ type: 'intent', intent: { type: 'cycle-density' } }, host);
    executeCapabilityTarget({ type: 'intent', intent: { type: 'sign-out' } }, host);

    expect(host.createWorkspace).toHaveBeenCalledOnce();
    expect(host.cycleDensity).toHaveBeenCalledOnce();
    expect(host.signOut).toHaveBeenCalledOnce();
  });
});
