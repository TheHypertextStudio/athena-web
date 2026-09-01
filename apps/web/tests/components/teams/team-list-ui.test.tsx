import '@testing-library/jest-dom/vitest';

import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { TeamRows } from '../../../src/components/teams/team-list-ui';
import { TeamOut } from '../../../src/lib/contracts/team';

const ORG_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const TEAM_ID = '01ARZ3NDEKTSV4RRFFQ69G5FA1';

const TEAM = TeamOut.parse({
  id: TEAM_ID,
  organizationId: ORG_ID,
  name: 'Platform',
  key: 'PLAT',
  summary: 'Owns the application platform.',
  workflowStates: [
    { key: 'backlog', name: 'Backlog', type: 'backlog', position: 0 },
    { key: 'started', name: 'Started', type: 'started', position: 1 },
    { key: 'completed', name: 'Completed', type: 'completed', position: 2 },
  ],
  triageEnabled: true,
});

function renderTeamRows(): ReturnType<typeof render> {
  return render(
    <TeamRows
      rows={[
        {
          team: TEAM,
          projectCount: 2,
          taskCount: 1,
          workflowStateCount: 3,
        },
      ]}
      orgId={ORG_ID}
      projectNoun="project"
      projectNounPlural="projects"
      taskNoun="task"
      taskNounPlural="tasks"
      ariaLabel="Workspace teams"
    />,
  );
}

describe('TeamRows', () => {
  it('renders one linked object row with its counts and triage state', () => {
    renderTeamRows();

    const grid = screen.getByRole('grid', { name: 'Workspace teams' });
    const row = within(grid).getByRole('row', { name: /Platform/ });
    expect(row).toHaveAttribute('data-object-kind', 'team');
    expect(row).toHaveAttribute('data-object-id', TEAM_ID);
    expect(row).toHaveAttribute('href', `/orgs/${ORG_ID}/teams/${TEAM_ID}`);
    expect(within(row).getByText('3')).toHaveAccessibleName('3 workflow states');
    expect(within(row).getByLabelText('2 projects')).toHaveTextContent('2');
    expect(within(row).getByLabelText('1 task')).toHaveTextContent('1');
    expect(within(row).getByText('Triage')).toBeVisible();
  });

  it('uses one responsive column contract for every header and body cell', () => {
    const { container } = renderTeamRows();
    const priorities = [
      ['team', ['flex']],
      ['states', ['hidden', '@xl/table:flex']],
      ['projects', ['hidden', '@lg/table:flex']],
      ['tasks', ['hidden', '@md/table:flex']],
    ] as const;

    expect(
      screen.getAllByRole('columnheader').map((header) => header.getAttribute('data-col')),
    ).toEqual(priorities.map(([key]) => key));

    for (const [key, visibilityClasses] of priorities) {
      const cells = container.querySelectorAll(`[data-col="${key}"]`);
      expect(cells).toHaveLength(2);
      for (const cell of cells) {
        for (const className of visibilityClasses) {
          expect(cell).toHaveClass(className);
        }
      }
    }
  });
});
