import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { TaskViewDefinition, TaskWorkViewFacetResponse } from '@docket/work/work-view-contract';
import { WorkViewToolbar } from '../../src/components/work-views/work-view-toolbar';
const taskDefinition = TaskViewDefinition.parse({
  version: 2,
  target: 'task',
  filter: null,
  arrangement: { groupBy: null, subGroupBy: null, orderBy: [] },
  presentation: { layout: 'list', properties: [], density: 'compact', showEmptyGroups: false },
});

it('uses named template facets in active filters and the template value picker', async () => {
  const id = '01ARZ3NDEKTSV4RRFFQ69G5FA1';
  const facets = TaskWorkViewFacetResponse.parse({
    target: 'task',
    buckets: [
      {
        field: 'workTypeId',
        options: [
          {
            value: id,
            label: 'Community event',
            icon: { kind: 'symbol', name: 'event' },
            count: 2,
          },
        ],
        emptyCount: 0,
        nextCursor: null,
      },
    ],
    distinctCount: 2,
  });
  const definition = TaskViewDefinition.parse({
    ...taskDefinition,
    filter: { kind: 'predicate', field: 'workTypeId', operator: 'is', operand: id },
  });
  render(
    <WorkViewToolbar
      target="task"
      definition={definition}
      facetResponse={facets}
      onDefinitionChange={vi.fn()}
      onSaveView={vi.fn()}
      onSetDefault={vi.fn()}
      onReset={vi.fn()}
    />,
  );
  expect(screen.getByText('Template is Community event')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Template is Community event' }));
  expect(screen.getByRole('checkbox', { name: 'Community event, 2 matches' })).toBeInTheDocument();
  expect(screen.queryByText(id)).not.toBeInTheDocument();
  expect(document.querySelector('[data-glyph-value="event"]')).toBeInTheDocument();
});
