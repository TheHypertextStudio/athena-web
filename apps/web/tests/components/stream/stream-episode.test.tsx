import '@testing-library/jest-dom/vitest';

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { StreamEpisodeView } from '@/components/stream/stream-episode';
import type { StreamEpisode } from '@/components/stream/stream-grouping';
import type { StreamEventRow } from '@/components/stream/stream-meta';

afterEach(cleanup);

function event(id: string, overrides: Partial<StreamEventRow> = {}): StreamEventRow {
  return {
    id,
    organizationId: 'org_1',
    system: 'docket',
    origin: 'docket',
    externalUrl: null,
    kind: 'completed',
    occurredAt: '2026-06-29T12:00:00.000Z',
    title: 'Completed Ship the beta',
    summary: null,
    permalink: null,
    actorSource: 'docket',
    actorExternalId: 'actor_1',
    actorDocketId: 'actor_1',
    actorName: 'Willie Chalmers III',
    actorAvatarUrl: null,
    actorIsViewer: true,
    entityKind: 'work_item',
    entityTitle: 'Ship the beta',
    entityExternalId: 'ENG-482',
    entityDocketId: 'task_482',
    entityUrl: null,
    relevance: null,
    rendering: { icon: 'completed', category: 'progress' },
    detail: { schema: 'docket.state_change', fromState: 'in_progress', toState: 'done' },
    ...overrides,
  };
}

function episode(overrides: Partial<StreamEpisode> = {}): StreamEpisode {
  const completed = event('completed');
  const changed = event('changed', {
    kind: 'field_change',
    actorIsViewer: false,
    actorName: 'Maya Chen',
    actorExternalId: 'actor_maya',
    occurredAt: '2026-06-29T11:58:00.000Z',
    detail: {
      schema: 'docket.field_change',
      fields: ['dueDate'],
      changes: [{ field: 'dueDate', label: 'Due date', from: 'Aug 10', to: 'Aug 12' }],
    },
  });
  return {
    key: `ep:${completed.id}`,
    subjectKey: 'org_1:docket:task_482',
    allEvents: [completed, changed],
    visibleEvents: [completed, changed],
    relatedEvents: [],
    minorOnly: false,
    ...overrides,
  };
}

describe('StreamEpisodeView', () => {
  it('renders the subject once and keeps substantive changes as separate lines', () => {
    render(<StreamEpisodeView episode={episode()} scope="org" />);
    expect(screen.getAllByText('Ship the beta')).toHaveLength(1);
    expect(screen.getByText('You completed the task')).toBeInTheDocument();
    expect(screen.getByText('In progress → Done')).toBeInTheDocument();
    expect(screen.getByText('Maya Chen updated details')).toBeInTheDocument();
    expect(screen.getByText('Due date: Aug 10 → Aug 12')).toBeInTheDocument();
    expect(screen.queryByText('Willie Chalmers III')).not.toBeInTheDocument();
    expect(screen.queryByText('Docket')).not.toBeInTheDocument();
  });

  it('shows external source and Hub workspace once in the subject header', () => {
    const linear = event('linear', {
      system: 'linear',
      origin: 'external',
      externalUrl: 'https://linear.app/acme/issue/ENG-482',
      permalink: 'https://linear.app/acme/issue/ENG-482',
    });
    render(
      <StreamEpisodeView
        episode={episode({ allEvents: [linear], visibleEvents: [linear] })}
        scope="me"
        orgName="Acme"
      />,
    );
    expect(screen.getAllByText('Linear')).toHaveLength(1);
    expect(screen.getAllByText('Acme')).toHaveLength(1);
  });

  it('expands related activity in place with an explicit count', () => {
    const completed = event('completed');
    const reaction = event('reaction', {
      kind: 'reaction',
      occurredAt: '2026-06-29T11:59:00.000Z',
      detail: null,
    });
    render(
      <StreamEpisodeView
        episode={episode({
          allEvents: [completed, reaction],
          visibleEvents: [completed],
          relatedEvents: [reaction],
        })}
        scope="org"
      />,
    );
    const disclosure = screen.getByRole('button', { name: 'Show 1 related event' });
    expect(disclosure).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('You reacted')).not.toBeInTheDocument();
    fireEvent.click(disclosure);
    expect(disclosure).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('You reacted')).toBeInTheDocument();
  });

  it('opens the exact event from an event line', () => {
    const onSelect = vi.fn();
    const item = event('completed');
    render(
      <StreamEpisodeView
        episode={episode({ allEvents: [item], visibleEvents: [item] })}
        scope="org"
        onSelect={onSelect}
      />,
    );
    fireEvent.click(screen.getByText('You completed the task'));
    expect(onSelect).toHaveBeenCalledWith(item);
  });
});
