import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/components/athena/athena-conversation', () => ({
  default: ({ draftRequest }: { draftRequest: { text: string } | null }) => (
    <div data-testid="conversation">{draftRequest?.text ?? ''}</div>
  ),
}));

import PlanConversation from '../../src/components/plan-canvas/plan-conversation';

function renderColumn(onClose = vi.fn()) {
  render(
    <>
      <button type="button" data-plan-athena-toggle="true">
        Athena
      </button>
      <PlanConversation
        orgId="org_1"
        draftRequest={{ text: 'Help me plan "Q3". ', version: 1 }}
        fullHref="/athena?workspace=org_1"
        offsetRight={0}
        onClose={onClose}
        onWidthChange={vi.fn()}
      />
    </>,
  );
  return onClose;
}

describe('PlanConversation', () => {
  it('is a named aside carrying the conversation and its draft', () => {
    renderColumn();
    const aside = screen.getByRole('complementary', { name: 'Athena' });
    expect(aside).toContainElement(screen.getByTestId('conversation'));
    expect(screen.getByTestId('conversation')).toHaveTextContent('Help me plan');
    expect(screen.getByRole('link', { name: /Open full/ })).toHaveAttribute(
      'href',
      '/athena?workspace=org_1',
    );
  });

  it('closes from its button and from Escape, handing focus to the toggle', () => {
    const onClose = renderColumn();
    fireEvent.click(screen.getByRole('button', { name: 'Close Athena' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Athena' }));
    fireEvent.keyDown(screen.getByTestId('conversation'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
