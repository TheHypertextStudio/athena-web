import '@testing-library/jest-dom/vitest';

import { OrganizationId, TaskId } from '@docket/types';
import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AgendaEntry } from '../../src/components/agenda/agenda-model';

const agendaState = vi.hoisted(() => ({
  displayTimezone: 'Asia/Tokyo',
  toggleDone: vi.fn(),
}));

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock('../../src/components/active-org', () => ({
  useActiveOrg: () => ({ orgName: () => 'Personal' }),
}));

vi.mock('../../src/components/org-chip', () => ({
  OrgChip: ({ name }: { name: string }) => <span>{name}</span>,
}));

vi.mock('../../src/components/agenda/agenda-context', () => ({
  agendaEntryTransitionName: (id: string) => `agenda-${id}`,
  isTimeboxed: (entry: AgendaEntry) => Boolean(entry.startsAt && entry.endsAt),
  useAgenda: () => agendaState,
}));

vi.mock('../../src/components/agenda/agenda-entry-actions', () => ({
  default: () => null,
}));

import AgendaEntryCard from '../../src/components/agenda/agenda-entry-card';

const ENTRY: AgendaEntry = {
  id: 'tokyo-timebox',
  source: 'task',
  taskId: TaskId.parse('01ARZ3NDEKTSV4RRFFQ69G5FA0'),
  organizationId: OrganizationId.parse('01BX5ZZKBKACTAV9WEVGEMMVRZ'),
  title: 'Tokyo planning block',
  startsAt: '2026-07-01T16:00:00.000Z',
  endsAt: '2026-07-01T17:00:00.000Z',
  sort: 0,
  done: false,
};

afterEach(() => {
  cleanup();
  agendaState.displayTimezone = 'Asia/Tokyo';
});

describe('AgendaEntryCard timezone presentation', () => {
  it('renders the timebox in the selected display timezone', () => {
    render(<AgendaEntryCard entry={ENTRY} layout="block" />);

    expect(screen.getByText('1:00 AM – 2:00 AM')).toBeInTheDocument();
  });

  it('disambiguates a repeated-hour range in the Agenda timeline', () => {
    agendaState.displayTimezone = 'America/Los_Angeles';
    render(
      <AgendaEntryCard
        entry={{
          ...ENTRY,
          startsAt: '2026-11-01T08:30:00Z',
          endsAt: '2026-11-01T09:30:00Z',
        }}
        layout="block"
      />,
    );

    expect(screen.getByText('1:30 AM PDT – 1:30 AM PST')).toBeInTheDocument();
  });
});
