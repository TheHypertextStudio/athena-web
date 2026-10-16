import { useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { PlanActivityProvider, PlanAthenaAction } from '@/components/plan-canvas/plan-activity';

vi.mock('@/lib/query', () => ({ useLiveApiQuery: () => ({ data: undefined }) }));
vi.mock('@/components/plan-canvas/plan-conversation', () => ({
  PlanRailConversation: ({ orgId }: { orgId: string }) => {
    const [value, setValue] = useState('');
    return (
      <>
        <p>Conversation for {orgId}</p>
        <textarea
          aria-label="Plan message"
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
          }}
        />
      </>
    );
  },
}));
afterEach(cleanup);

it('keeps help optional and opens the actual plan workspace conversation in a dismissible activity sheet', async () => {
  render(
    <PlanActivityProvider orgId="org_1">
      <p>Plan board</p>
      <PlanAthenaAction />
    </PlanActivityProvider>,
  );
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  const opener = screen.getByRole('button', { name: 'Ask Athena about this plan' });
  opener.focus();
  fireEvent.click(opener);
  expect(screen.getByRole('dialog', { name: 'Plan with Athena' })).toBeVisible();
  expect(screen.getByText('Conversation for org_1')).toBeVisible();
  fireEvent.change(screen.getByRole('textbox', { name: 'Plan message' }), {
    target: { value: 'Keep this plan draft' },
  });
  expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Back to plan' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(opener).toHaveFocus();
  fireEvent.click(opener);
  expect(screen.getByRole('textbox', { name: 'Plan message' })).toHaveValue('Keep this plan draft');
});

it('closes optional help with Escape and keeps the plan mounted', async () => {
  render(
    <PlanActivityProvider orgId="org_1">
      <p>Plan board</p>
      <PlanAthenaAction />
    </PlanActivityProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Ask Athena about this plan' }));
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape', code: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(screen.getByText('Plan board')).toBeVisible();
});
