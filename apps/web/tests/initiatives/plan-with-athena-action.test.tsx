import '@testing-library/jest-dom/vitest';

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { mutateAsync, openAthena, push } = vi.hoisted(() => ({
  mutateAsync: vi.fn(),
  openAthena: vi.fn(),
  push: vi.fn(),
}));

vi.mock('@/lib/plan-draft/defs', () => ({
  useCreatePlan: () => ({ mutateAsync, isPending: false }),
}));

vi.mock('@/components/athena/athena-panel-provider', () => ({
  useAthenaPanel: () => ({ openAthena }),
}));

vi.mock('@/lib/interactions/navigation', () => ({
  useAppRouter: () => ({ push }),
}));

import { PlanWithAthenaAction } from '../../src/components/initiatives/plan-with-athena-action';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('PlanWithAthenaAction', () => {
  it('starts or reopens the plan, seeds the rail, and opens the canvas', async () => {
    mutateAsync.mockResolvedValue({ id: 'plan_9' });
    render(
      <PlanWithAthenaAction
        orgId="org_1"
        initiativeId="ini_1"
        name="Spring giving"
        noun="Initiative"
        enabled
      />,
    );
    fireEvent.click(screen.getByTestId('plan-with-athena'));
    await waitFor(() => {
      expect(push).toHaveBeenCalledWith('/orgs/org_1/plans/plan_9');
    });
    expect(mutateAsync).toHaveBeenCalledWith({ organizationId: 'org_1', initiativeId: 'ini_1' });
    expect(openAthena).toHaveBeenCalledWith(
      { workspaceId: 'org_1', source: { type: 'initiative', id: 'ini_1', label: 'Spring giving' } },
      expect.stringContaining('Spring giving'),
    );
  });

  it('renders nothing when the viewer cannot plan here', () => {
    render(
      <PlanWithAthenaAction
        orgId="org_1"
        initiativeId="ini_1"
        name="X"
        noun="Initiative"
        enabled={false}
      />,
    );
    expect(screen.queryByTestId('plan-with-athena')).toBeNull();
  });
});
