import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import {
  PlanningPanelControls,
  visiblePlanningPanels,
  type PlanningPanels,
} from '@/components/daily-planning/daily-planning-panels';
vi.mock('@docket/ui/hooks', () => ({ useMediaQuery: () => false }));
afterEach(cleanup);

it('switches between work and agenda on phones while retaining the chosen work', () => {
  function Harness() {
    const [panels, setPanels] = useState<PlanningPanels>({ work: true, agenda: true });
    const shown = visiblePlanningPanels(panels, false, false);
    return (
      <>
        <PlanningPanelControls panels={panels} onChange={setPanels} />
        <section hidden={!shown.work}>
          <label>
            Planned minutes
            <input defaultValue="45" />
          </label>
        </section>
        <section hidden={!shown.agenda}>Invitation at 10 AM</section>
      </>
    );
  }
  render(<Harness />);
  fireEvent.change(screen.getByLabelText('Planned minutes'), { target: { value: '90' } });
  expect(screen.queryByText('Invitation at 10 AM')).not.toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Agenda' }));
  expect(screen.getByText('Invitation at 10 AM')).toBeVisible();
  expect(screen.getByLabelText('Planned minutes')).not.toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Work' }));
  expect(screen.getByLabelText('Planned minutes')).toHaveValue('90');
});

it('starts final review on the agenda while desktop retains both panels', () => {
  const panels = { work: true, agenda: true };
  expect(visiblePlanningPanels(panels, true, false)).toEqual({ work: false, agenda: true });
  expect(visiblePlanningPanels(panels, false, true)).toEqual(panels);
});
