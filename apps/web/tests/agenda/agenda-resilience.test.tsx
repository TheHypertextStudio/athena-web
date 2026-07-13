/**
 * Regression coverage for the shell agenda's degraded-data rendering contract.
 *
 * @remarks
 * The agenda is ambient shell UI: a failed server read may disclose staleness, but must not replace
 * the date controls and canvas with raw error copy. These tests pin that boundary independently of
 * the query implementation by supplying the context states the portable surface consumes.
 */
import type { ReactNode } from 'react';

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const agendaState = vi.hoisted(() => ({
  loading: false,
  error: null as string | null,
  retrying: false,
  retry: vi.fn(),
}));

vi.mock('../../src/components/agenda/agenda-context', () => ({
  AgendaProvider: ({ children }: { children: ReactNode }) => children,
  useAgenda: () => agendaState,
}));

vi.mock('../../src/components/agenda/agenda-header', () => ({
  default: () => <div>Agenda date controls</div>,
}));

vi.mock('../../src/components/agenda/agenda-canvas', () => ({
  default: () => <div>Agenda canvas</div>,
}));

import Agenda from '../../src/components/agenda/agenda';

describe('Agenda degraded-data rendering', () => {
  beforeEach(() => {
    agendaState.loading = false;
    agendaState.error = null;
    agendaState.retrying = false;
    agendaState.retry.mockReset();
  });

  it('keeps the agenda controls and canvas visible when the server read fails', () => {
    agendaState.error = 'Internal server error';

    render(<Agenda />);

    expect(screen.getByText('Agenda date controls')).toBeTruthy();
    expect(screen.getByText('Agenda canvas')).toBeTruthy();
    expect(screen.queryByText('Internal server error')).toBeNull();
    expect(
      screen.getByText('Calendar updates are temporarily unavailable. Showing what we have.'),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(agendaState.retry).toHaveBeenCalledOnce();
    expect(screen.getByText('Agenda date controls')).toBeTruthy();
    expect(screen.getByText('Agenda canvas')).toBeTruthy();
  });

  it('keeps the agenda canvas mounted while the first read is pending', () => {
    agendaState.loading = true;

    render(<Agenda />);

    expect(screen.getByText('Agenda date controls')).toBeTruthy();
    expect(screen.getByText('Agenda canvas')).toBeTruthy();
    expect(screen.getByText('Loading calendar…')).toBeTruthy();
  });
});
