import { UserFacingError } from '@/lib/problem';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkTemplateArchiveImpact } from '@docket/work/work-template-contract';
import { WorkTemplateArchiveAction } from '@/components/templates/work-template-archive-action';
const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  definition: vi.fn(),
  mutate: vi.fn(),
  refetch: vi.fn(),
}));
vi.mock('@/components/templates/work-template-archive-queries', () => ({
  workTemplateArchiveImpactDef: mocks.definition,
}));
vi.mock('@/lib/query', () => ({ useApiQuery: mocks.query }));
vi.mock('@/components/templates/work-template-queries', () => ({
  useWorkTemplateWrites: () => ({ archive: { mutate: mocks.mutate, isPending: false } }),
}));
const data: WorkTemplateArchiveImpact = {
  parents: { items: [{ id: 'p', name: 'Dinner' }], total: 21, nextOffset: 20 },
  schedules: { items: [{ id: 's', name: 'Weekly report' }], total: 1, nextOffset: null },
};
function query(overrides: Record<string, unknown> = {}) {
  mocks.query.mockReturnValue({
    data,
    isError: false,
    isPending: false,
    isFetching: false,
    error: null,
    refetch: mocks.refetch,
    ...overrides,
  });
}
function open() {
  fireEvent.click(screen.getByRole('button', { name: 'Archive template' }));
  return screen.getByRole('dialog');
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.definition.mockImplementation(
    (_org: string, _id: string, parentOffset: number, scheduleOffset: number) => ({
      parentOffset,
      scheduleOffset,
    }),
  );
  query();
});
describe('template archive impact review', () => {
  it('loads only when opened and reviews authorized names and totals before one archive', () => {
    render(<WorkTemplateArchiveAction orgId="org" id="template" />);
    expect(mocks.query).toHaveBeenLastCalledWith(expect.objectContaining({ enabled: false }));
    const dialog = open();
    expect(mocks.query).toHaveBeenLastCalledWith(expect.objectContaining({ enabled: true }));
    expect(within(dialog).getByText('Dinner')).toBeInTheDocument();
    expect(within(dialog).getByText('Weekly report')).toBeInTheDocument();
    expect(
      within(dialog).getByRole('heading', { name: 'Templates using this (21)' }),
    ).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Archive template' }));
    expect(mocks.mutate).toHaveBeenCalledExactlyOnceWith('template', expect.any(Object));
  });
  it('keeps Cancel usable while the review loads and blocks premature confirmation', () => {
    query({ data: undefined, isPending: true });
    render(<WorkTemplateArchiveAction orgId="org" id="template" />);
    const dialog = open();
    expect(within(dialog).getByRole('button', { name: 'Archive template' })).toBeDisabled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(mocks.mutate).not.toHaveBeenCalled();
  });
  it('blocks archive on read failure and retries using application-owned feedback', () => {
    query({
      data: undefined,
      isError: true,
      error: new UserFacingError('Private backend text', { status: 503 }),
    });
    render(<WorkTemplateArchiveAction orgId="org" id="template" />);
    const dialog = open();
    expect(within(dialog).getByRole('button', { name: 'Archive template' })).toBeDisabled();
    expect(screen.queryByText('Private backend text')).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: /retry|try again/i }));
    expect(mocks.refetch).toHaveBeenCalledOnce();
  });
  it('pages each reference list independently and resets pages on reopen', () => {
    render(<WorkTemplateArchiveAction orgId="org" id="template" />);
    const dialog = open();
    const parents = within(dialog).getByRole('region', { name: 'Templates using this' });
    expect(
      within(parents).getByRole('button', { name: 'Previous templates using this' }),
    ).toHaveTextContent(/^Previous$/);
    const more = within(parents).getByRole('button', { name: 'More templates using this' });
    expect(more).toHaveTextContent(/^More$/);
    fireEvent.click(more);
    expect(mocks.definition).toHaveBeenLastCalledWith('org', 'template', 20, 0);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    open();
    expect(mocks.definition).toHaveBeenLastCalledWith('org', 'template', 0, 0);
  });
  it('keeps a failed archive in its dialog with owned error copy', () => {
    mocks.mutate.mockImplementation((_id: string, callbacks: { onError: () => void }) => {
      callbacks.onError();
    });
    render(<WorkTemplateArchiveAction orgId="org" id="template" />);
    const dialog = open();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Archive template' }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent(
      'Could not archive the template. Try again.',
    );
  });
});
