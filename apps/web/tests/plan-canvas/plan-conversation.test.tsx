import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/components/athena/athena-conversation', () => ({
  default: ({ draftRequest }: { draftRequest: { text: string } | null }) => (
    <div data-testid="conversation">{draftRequest?.text ?? ''}</div>
  ),
}));
vi.mock('../../src/components/athena/athena-panel-provider', () => ({
  useAthenaPanel: () => ({ launchDraft: 'Help me plan "Q3". ' }),
}));

import { PlanRailConversation } from '../../src/components/plan-canvas/plan-conversation';

describe('PlanRailConversation', () => {
  it('carries the mark, a way to the full page, and the thread seeded with the launch draft', () => {
    render(<PlanRailConversation orgId="org_1" />);
    expect(screen.getByRole('link', { name: 'Open the Athena page' })).toHaveAttribute(
      'href',
      expect.stringContaining('org_1'),
    );
    expect(screen.getByTestId('conversation')).toHaveTextContent('Help me plan "Q3".');
  });
});
