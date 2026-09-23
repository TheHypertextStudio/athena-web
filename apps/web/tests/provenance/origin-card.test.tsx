/**
 * The Created row's origin card: dormant until asked, then who created the entity and who last
 * changed it.
 */
import '@testing-library/jest-dom/vitest';

import { ActorId } from '@docket/identity-access/ids';
import type { ProvenanceEventOut, ProvenanceOut } from '@docket/work/provenance-contract';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CreatedOriginChip,
  CreatedOriginDate,
  provenanceSubjectOf,
} from '../../src/components/provenance/created-origin';
import { EntityMetadataRow } from '../../src/components/views/entity-detail-layout';
import type { ProvenanceSubject } from '../../src/lib/provenance/defs';
import { clearOriginRequest, requestOrigin } from '../../src/lib/provenance/origin-request';
import { mockWideMetadataRow } from '../support/metadata-row-layout';
import { okResponse } from '../support/query';

const provenanceGet = vi.hoisted(() => vi.fn());

vi.mock('../../src/lib/api', () => ({
  api: {
    v1: {
      orgs: {
        ':orgId': { provenance: { ':kind': { ':id': { $get: provenanceGet } } } },
      },
    },
  },
}));

const SUBJECT: ProvenanceSubject = {
  kind: 'task',
  id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
  organizationId: '01ARZ3NDEKTSV4RRFFQ69G5FAW',
};

const CREATED: ProvenanceEventOut = {
  at: '2026-09-20T10:00:00.000Z',
  channel: 'mcp',
  surface: null,
  performerKind: 'agent',
  performerName: 'Claude Code',
  authorityActorId: ActorId.parse('01ARZ3NDEKTSV4RRFFQ69G5F91'),
  authorityName: 'Ada Lovelace',
  clientName: 'Claude Code',
  provider: null,
  sessionId: null,
  planId: null,
};

const CHANGED: ProvenanceEventOut = {
  ...CREATED,
  at: '2026-09-21T10:00:00.000Z',
  channel: 'app',
  surface: 'detail',
  performerKind: 'person',
  performerName: null,
  clientName: null,
};

function answer(body: ProvenanceOut): void {
  provenanceGet.mockResolvedValue(okResponse(body));
}

function renderWithQuery(ui: ReactElement): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  provenanceGet.mockReset();
});

afterEach(() => {
  cleanup();
  clearOriginRequest();
  vi.restoreAllMocks();
});

describe('CreatedOriginDate', () => {
  it('reads nothing until the date is focused, then shows both sides', async () => {
    answer({ created: CREATED, lastChanged: CHANGED, changeCount: 2 });
    renderWithQuery(<CreatedOriginDate subject={SUBJECT} createdAt={CREATED.at} />);

    const trigger = screen.getByRole('button');
    expect(provenanceGet).not.toHaveBeenCalled();
    fireEvent.focus(trigger);

    const card = await screen.findByLabelText('Origin');
    expect(provenanceGet).toHaveBeenCalledWith({
      param: { orgId: SUBJECT.organizationId, kind: 'task', id: SUBJECT.id },
    });
    expect(within(card).getAllByRole('term')).toHaveLength(2);
    const kinds = [...card.querySelectorAll('[data-actor-kind]')].map((avatar) =>
      avatar.getAttribute('data-actor-kind'),
    );
    expect(kinds).toEqual(['agent', 'human']);
    expect(within(card).getByText('Claude Code')).toBeInTheDocument();
    expect(card.querySelectorAll('time[datetime]')).toHaveLength(2);
  });

  it('opens after a hover', async () => {
    answer({ created: CREATED, lastChanged: CHANGED, changeCount: 2 });
    renderWithQuery(<CreatedOriginDate subject={SUBJECT} createdAt={CREATED.at} />);

    fireEvent.pointerEnter(screen.getByRole('button'));

    expect(await screen.findByLabelText('Origin')).toBeInTheDocument();
    expect(provenanceGet).toHaveBeenCalledTimes(1);
  });

  it('opens at once on a click, leaving out a side with nothing to say', async () => {
    answer({ created: CREATED, lastChanged: null, changeCount: 1 });
    renderWithQuery(<CreatedOriginDate subject={SUBJECT} createdAt={CREATED.at} />);

    fireEvent.click(screen.getByRole('button'));

    const card = await screen.findByLabelText('Origin');
    expect(within(card).getAllByRole('term')).toHaveLength(1);
    expect(card.querySelectorAll('[data-actor-kind="agent"]')).toHaveLength(1);
  });

  it('shows no card when neither side can be named', async () => {
    answer({ created: null, lastChanged: null, changeCount: 0 });
    renderWithQuery(<CreatedOriginDate subject={SUBJECT} createdAt={CREATED.at} />);

    fireEvent.click(screen.getByRole('button'));

    await waitFor(() => {
      expect(provenanceGet).toHaveBeenCalledTimes(1);
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByLabelText('Origin')).not.toBeInTheDocument();
    expect(screen.getByRole('button')).toBeVisible();
  });

  it('renders the plain date with no card when there is no entity to ask about', () => {
    renderWithQuery(<CreatedOriginDate createdAt={CREATED.at} />);

    fireEvent.click(screen.getByRole('button'));

    expect(provenanceGet).not.toHaveBeenCalled();
  });

  it('opens when the Show origin action asks for this entity', async () => {
    answer({ created: CREATED, lastChanged: CHANGED, changeCount: 2 });
    renderWithQuery(<CreatedOriginDate subject={SUBJECT} createdAt={CREATED.at} />);

    act(() => {
      requestOrigin({ kind: 'task', id: SUBJECT.id });
    });

    expect(await screen.findByLabelText('Origin')).toBeInTheDocument();
  });

  it('ignores a request for another entity', () => {
    renderWithQuery(<CreatedOriginDate subject={SUBJECT} createdAt={CREATED.at} />);

    act(() => {
      requestOrigin({ kind: 'task', id: 'another-task' });
    });

    expect(provenanceGet).not.toHaveBeenCalled();
  });
});

describe('CreatedOriginChip', () => {
  it('opens the metadata row overflow to answer a Show origin request', async () => {
    mockWideMetadataRow();
    answer({ created: CREATED, lastChanged: null, changeCount: 1 });
    renderWithQuery(
      <EntityMetadataRow ariaLabel="Task properties">
        <CreatedOriginChip subject={SUBJECT} createdAt={CREATED.at} />
      </EntityMetadataRow>,
    );
    expect(screen.queryByRole('group', { name: 'More Task properties' })).not.toBeInTheDocument();

    act(() => {
      requestOrigin({ kind: 'task', id: SUBJECT.id });
    });

    const overflow = await screen.findByRole('group', { name: 'More Task properties' });
    expect(within(overflow).getByRole('button', { name: /Created/ })).toBeVisible();
    expect(await screen.findByLabelText('Origin')).toBeInTheDocument();
  });
});

describe('provenanceSubjectOf', () => {
  it('covers work kinds in a workspace and nothing else', () => {
    const base = { id: 'x', organizationId: 'org', title: 'X' };
    expect(provenanceSubjectOf({ ...base, kind: 'project' })).toEqual({
      kind: 'project',
      id: 'x',
      organizationId: 'org',
    });
    expect(provenanceSubjectOf({ ...base, kind: 'cycle' })).toBeNull();
    expect(provenanceSubjectOf({ ...base, kind: 'task', organizationId: null })).toBeNull();
    expect(provenanceSubjectOf(null)).toBeNull();
  });
});
