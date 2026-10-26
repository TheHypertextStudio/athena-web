import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkTypeLabel } from '@/components/templates/work-type-label';

const state = vi.hoisted(() => ({
  identity: undefined as { name: string; isBase: boolean } | undefined,
}));
vi.mock('@/lib/query', () => ({ useApiQuery: () => ({ data: state.identity }) }));
vi.mock('@/components/templates/work-template-identity-queries', () => ({
  workTemplateIdentityDef: () => ({}),
}));

const props = {
  orgId: 'org',
  kind: 'project' as const,
  workTypeId: 'type',
  workTypeVersionId: 'version',
};
beforeEach(() => {
  state.identity = undefined;
});

describe('authored work type labels', () => {
  it('does not invent a generic type while the saved identity is unavailable', () => {
    const { container } = render(<WorkTypeLabel {...props} />);
    expect(container).toBeEmptyDOMElement();
  });
  it('omits the base definition label', () => {
    state.identity = { name: 'Blank project', isBase: true };
    const { container } = render(<WorkTypeLabel {...props} />);
    expect(container).toBeEmptyDOMElement();
  });
  it('preserves the exact user-authored type name', () => {
    state.identity = { name: 'Community gathering', isBase: false };
    render(<WorkTypeLabel {...props} />);
    expect(screen.getByText('Community gathering', { exact: true })).toBeVisible();
  });
  it('retains a custom type literally named Project', () => {
    state.identity = { name: 'Project', isBase: false };
    render(<WorkTypeLabel {...props} />);
    expect(screen.getByText('Project', { exact: true })).toBeVisible();
  });
});
