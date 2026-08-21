import '@testing-library/jest-dom/vitest';

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { FieldCatalog, ViewState } from '@/components/views/field-catalog';
import { FilterToolbar } from '@/components/views/filter-toolbar';

interface ResourceRow {
  readonly name: string;
  readonly contexts: readonly string[];
}

const catalog: FieldCatalog<ResourceRow> = [
  {
    key: 'usedIn',
    label: 'Work context',
    type: 'relation',
    accessor: (row) => row.contexts[0] ?? null,
    values: (row) => row.contexts,
    groupable: true,
  },
];

describe('FilterToolbar display trigger', () => {
  it('names the active grouping without replacing the shared Display control', () => {
    const state: ViewState = { filters: [], groupBy: { field: 'usedIn' }, sort: [] };
    render(
      <FilterToolbar
        catalog={catalog}
        state={state}
        onFiltersChange={vi.fn()}
        onGroupByChange={vi.fn()}
        onSortChange={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: /Display · Work context/ })).toHaveAttribute(
      'aria-label',
      'Display · Work context',
    );
  });
});
