import '@testing-library/jest-dom/vitest';

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { StreamRow } from '@/components/stream/stream-event-row';
import type { StreamEventRow } from '@/components/stream/stream-meta';

afterEach(cleanup);

function mkRow(over: Partial<StreamEventRow> = {}): StreamEventRow {
  return {
    id: 'o1',
    organizationId: 'org_1',
    system: 'linear',
    origin: 'external',
    externalUrl: 'https://linear.app/acme/issue/ENG-1',
    kind: 'mention',
    occurredAt: '2026-06-29T12:00:00.000Z',
    title: 'You were mentioned',
    summary: 'review the OAuth fix',
    permalink: 'https://linear.app/acme/issue/ENG-1',
    actorName: 'Maya',
    actorAvatarUrl: null,
    entityKind: 'work_item',
    entityTitle: 'Ship the beta',
    entityExternalId: 'ENG-1',
    entityDocketId: null,
    entityUrl: null,
    relevance: 'mention',
    rendering: { icon: 'mention', category: 'social' },
    detail: null,
    ...over,
  };
}

describe('StreamRow', () => {
  it('renders the composed description, provider badge, and workspace chip (cross-org)', () => {
    render(<StreamRow row={mkRow()} scope="me" orgName="Acme" actions={{}} />);
    expect(screen.getByText('Maya mentioned you in Ship the beta')).toBeInTheDocument();
    expect(screen.getByText('Linear')).toBeInTheDocument();
    expect(screen.getByText('Acme')).toBeInTheDocument();
    expect(screen.getByText('review the OAuth fix')).toBeInTheDocument();
  });

  it('omits the workspace chip in workspace scope', () => {
    render(<StreamRow row={mkRow()} scope="org" actions={{}} />);
    expect(screen.queryByText('Acme')).not.toBeInTheDocument();
  });

  it('fires onSelect when the body is clicked', () => {
    const onSelect = vi.fn();
    render(<StreamRow row={mkRow()} scope="org" actions={{}} onSelect={onSelect} />);
    fireEvent.click(screen.getByText('Maya mentioned you in Ship the beta'));
    expect(onSelect).toHaveBeenCalledOnce();
  });

  it('renders the Ask-Athena action only when the handler is provided', () => {
    const { rerender } = render(<StreamRow row={mkRow()} scope="org" actions={{}} />);
    expect(screen.queryByLabelText('Ask Athena')).not.toBeInTheDocument();
    rerender(<StreamRow row={mkRow()} scope="org" actions={{ onAskAthena: vi.fn() }} />);
    expect(screen.getByLabelText('Ask Athena')).toBeInTheDocument();
  });
});
