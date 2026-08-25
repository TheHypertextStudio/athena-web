import type { CapabilityTarget } from './types';

/** The effectful application boundary that executes catalog targets. */
export interface CapabilityExecutor {
  readonly navigate: (href: string) => void;
  readonly openPanel: (panelId: 'agenda' | 'focus' | 'athena') => void;
  readonly openCreate: (
    kind: 'task' | 'project' | 'initiative' | 'program',
    templateId?: string,
  ) => void;
  readonly createWorkspace: () => void;
  readonly cycleDensity: () => void;
  readonly signOut: () => void;
}

/** Execute one declarative catalog target through shell-owned services. */
export function executeCapabilityTarget(
  target: CapabilityTarget,
  executor: CapabilityExecutor,
): void {
  if (target.type === 'route') {
    executor.navigate(target.href);
    return;
  }

  switch (target.intent.type) {
    case 'open-panel':
      executor.openPanel(target.intent.panelId);
      return;
    case 'create':
      executor.openCreate(target.intent.kind, target.intent.templateId);
      return;
    case 'create-workspace':
      executor.createWorkspace();
      return;
    case 'cycle-density':
      executor.cycleDensity();
      return;
    case 'sign-out':
      executor.signOut();
  }
}
