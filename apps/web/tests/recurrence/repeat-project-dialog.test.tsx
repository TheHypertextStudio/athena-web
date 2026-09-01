/** Focused setup UI for repeating a project-shaped body of work. */
import type { MilestoneOut } from '@docket/work/milestone-contract';
import type { ProjectOut } from '../../src/lib/contracts/project';
import type { TaskOut } from '@docket/work/task-model';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/lib/api', () => ({ api: { v1: { orgs: { ':orgId': {} } } } }));

import { RepeatProjectDialog } from '../../src/components/recurrence/repeat-project-dialog';
import { assertDefined } from '@docket/test-utils';

afterEach(cleanup);

const PROJECT = {
  id: 'PRJ00000000000000000000001',
  organizationId: '0RG00000000000000000000001',
  name: 'Intro to Urbanism Workshop',
  summary: 'A practical first workshop.',
  description: null,
  status: 'active',
  health: null,
  leadId: null,
  teamId: null,
  programId: null,
  startDate: '2026-09-10',
  targetDate: '2026-09-20',
  createdAt: '2026-08-01T00:00:00.000Z',
} as unknown as ProjectOut;

const MILESTONES = [
  {
    id: 'MLS00000000000000000000001',
    organizationId: PROJECT.organizationId,
    projectId: PROJECT.id,
    name: 'Workshop day',
    description: null,
    targetDate: '2026-09-18',
    sort: 0,
    createdAt: '2026-08-01T00:00:00.000Z',
  },
] as unknown as readonly MilestoneOut[];

function task(id: string, title: string): TaskOut {
  return {
    id,
    organizationId: PROJECT.organizationId,
    title,
    teamId: 'TEAM0000000000000000000002',
    state: 'backlog',
    priority: 'none',
    provenance: { source: 'native' },
    labels: [],
    createdAt: '2026-08-01T00:00:00.000Z',
  } as unknown as TaskOut;
}

describe('RepeatProjectDialog', () => {
  it('reviews the concrete work and explains both release modes in product language', () => {
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <RepeatProjectDialog
          open
          onOpenChange={vi.fn()}
          orgId={PROJECT.organizationId}
          project={PROJECT}
          milestones={MILESTONES}
          tasks={[
            {
              task: task('TSK00000000000000000000001', 'Publish the event'),
              milestoneId: assertDefined(MILESTONES[0]).id,
            },
            {
              task: task('TSK00000000000000000000002', 'Host workshop'),
              milestoneId: assertDefined(MILESTONES[0]).id,
            },
            { task: task('TSK00000000000000000000003', 'Send follow-ups'), milestoneId: null },
          ]}
          projectNoun="Project"
          onCreated={vi.fn()}
        />
      </QueryClientProvider>,
    );

    expect(screen.getByRole('heading', { name: 'Repeat this project' })).toBeTruthy();
    expect(screen.getByText('One project, 1 milestone, and 3 tasks.')).toBeTruthy();
    expect(screen.getByText('Publish the event')).toBeTruthy();
    expect(screen.getByText('Host workshop')).toBeTruthy();
    expect(screen.getByText('Send follow-ups')).toBeTruthy();

    const fullPlan = screen.getByRole('radio', { name: /Show the full plan/ });
    const whenReady = screen.getByRole('radio', { name: /Show tasks when ready/ });
    expect((fullPlan as HTMLInputElement).checked).toBe(true);
    fireEvent.click(whenReady);
    expect((whenReady as HTMLInputElement).checked).toBe(true);
    expect(screen.getByRole('button', { name: /Repeat — Every month/ })).toBeTruthy();
  });
});
