import { buildAutomationRegistry } from '../../src/lib/automation/handlers';
import { runAutomationsForEvent } from '../../src/lib/automation/runtime';
import type { AutomationEvent } from '../../src/lib/automation/event';

/** Run a complete committed-event projection through the real runtime with a recording mail boundary. */
export async function fireAutomationTestEvent(
  orgId: string,
  event: Partial<AutomationEvent>,
): Promise<void> {
  const registry = buildAutomationRegistry({ mailApplier: async () => undefined });
  await runAutomationsForEvent(
    {
      organizationId: orgId,
      kind: 'created',
      source: 'docket',
      detail: {},
      occurredAt: new Date(0),
      ...event,
    },
    registry,
  );
}
