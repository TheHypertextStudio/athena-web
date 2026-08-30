import '@testing-library/jest-dom/vitest';

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { StreamEventLine } from '@/components/stream/stream-event-line';
import { streamHref, type StreamEventRow } from '@/components/stream/stream-meta';

afterEach(cleanup);

function event(overrides: Partial<StreamEventRow> = {}): StreamEventRow {
  return {
    id: 'evt_1',
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

/** Render one line and hand back its disclosure button. */
function renderLine(row: StreamEventRow, expanded: boolean): HTMLElement {
  render(<StreamEventLine row={row} expanded={expanded} onToggle={vi.fn()} />);
  return screen.getByRole('button');
}

describe('StreamEventLine', () => {
  it('points at a panel that is absent while collapsed', () => {
    const button = renderLine(event(), false);
    expect(button).toHaveAttribute('aria-expanded', 'false');
    const panelId = button.getAttribute('aria-controls');
    expect(panelId).toBeTruthy();
    expect(document.getElementById(String(panelId))).toBeNull();
  });

  it('names its expanded region from the line that opened it', () => {
    const button = renderLine(event(), true);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    const panel = document.getElementById(String(button.getAttribute('aria-controls')));
    expect(panel).toBeInTheDocument();
    expect(panel).toHaveAttribute('role', 'region');
    expect(panel).toHaveAttribute('aria-labelledby', button.id);
  });

  it('carries the exact instant and the subject link in the panel', () => {
    const row = event();
    const button = renderLine(row, true);
    const panel = document.getElementById(String(button.getAttribute('aria-controls')));
    expect(panel?.querySelector('time[datetime]')).not.toBeNull();
    expect(panel?.querySelector('a')).toHaveAttribute('href', streamHref(row));
  });

  it('marks a link as leaving the app only when it does', () => {
    const external = event({
      system: 'linear',
      origin: 'external',
      externalUrl: 'https://linear.app/acme/issue/ENG-482',
      permalink: 'https://linear.app/acme/issue/ENG-482',
    });
    const outward = renderLine(external, true);
    const outwardPanel = document.getElementById(String(outward.getAttribute('aria-controls')));
    expect(outwardPanel?.querySelector('a svg')).not.toBeNull();

    cleanup();

    const inward = renderLine(event(), true);
    const inwardPanel = document.getElementById(String(inward.getAttribute('aria-controls')));
    expect(inwardPanel?.querySelector('a svg')).toBeNull();
  });

  it('hides the actor avatar from assistive tech, which the sentence already names', () => {
    const button = renderLine(event(), false);
    expect(button.querySelector('[aria-hidden="true"] [data-actor-kind]')).not.toBeNull();
  });

  it('reports the actor kind through the avatar rather than through the name', () => {
    const button = renderLine(event({ kind: 'agent_completed' }), false);
    expect(button.querySelector('[data-actor-kind="agent"]')).not.toBeNull();
  });

  it('toggles through the handler the episode owns', () => {
    const onToggle = vi.fn();
    const row = event();
    render(<StreamEventLine row={row} expanded={false} onToggle={onToggle} />);
    fireEvent.click(screen.getByRole('button'));
    expect(onToggle).toHaveBeenCalledWith(row.id);
  });
});
