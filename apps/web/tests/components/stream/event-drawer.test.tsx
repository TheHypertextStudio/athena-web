import '@testing-library/jest-dom/vitest';

import { fireEvent, render, screen } from '@testing-library/react';
import type { StreamEventRow } from '@/components/stream/stream-meta';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/components/stream/athena-plan', () => ({
  AthenaPlan: () => <div>Athena plan</div>,
}));

import { EventDrawer } from '@/components/stream/event-drawer';

const row = {
  id: 'event-1',
  organizationId: 'org-1',
  system: 'docket',
  origin: 'docket',
  externalUrl: null,
  kind: 'created',
  occurredAt: '2026-08-29T12:00:00.000Z',
  title: 'Created project',
  summary: null,
  permalink: null,
  actorSource: null,
  actorExternalId: null,
  actorDocketId: null,
  actorName: 'Ada Lovelace',
  actorAvatarUrl: null,
  actorIsViewer: false,
  entityKind: 'project',
  entityTitle: 'Mobile remediation',
  entityExternalId: null,
  entityDocketId: 'project-1',
  entityUrl: null,
  relevance: null,
  rendering: { icon: 'project', category: 'work' },
  detail: null,
} as StreamEventRow;

describe('EventDrawer', () => {
  it('renders event details in the shared responsive sheet and closes through its close control', () => {
    const onClose = vi.fn();
    render(<EventDrawer row={row} onClose={onClose} />);

    const sheet = screen.getByRole('dialog', { name: 'Event details' });
    expect(sheet).toHaveAttribute('data-surface-tone', 'floating');
    expect(sheet).toHaveClass('overflow-hidden', 'inset-0');
    expect(screen.getByText('Mobile remediation')).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'Close event details' }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
