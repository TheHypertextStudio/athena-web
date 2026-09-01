import '@testing-library/jest-dom/vitest';

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorkLocationAssertionId, WorkPlaceId } from '@docket/planning/ids';

import { OccurrenceEditorDialog } from '@/components/work-location/occurrence-editor-dialog';

afterEach(cleanup);

describe('OccurrenceEditorDialog', () => {
  it('opens on the visible occurrence selected from the calendar', () => {
    render(
      <OccurrenceEditorDialog
        open
        onOpenChange={vi.fn()}
        assertion={{
          id: WorkLocationAssertionId.parse('01BX5ZZKBKACTAV9WEVGEMMVRZ'),
          placeId: WorkPlaceId.parse('01ARZ3NDEKTSV4RRFFQ69G5FAV'),
          schedule: {
            type: 'weekly_all_day',
            effectiveFrom: '2026-08-01',
            effectiveUntil: null,
            weekdays: [2],
            timezone: 'America/Los_Angeles',
          },
          exceptions: [],
          origin: 'docket',
          originProvider: null,
          originConnectionId: null,
          revision: 1,
          archivedAt: null,
          createdAt: '2026-08-01T00:00:00.000Z',
          updatedAt: '2026-08-01T00:00:00.000Z',
        }}
        date="2026-08-12"
        places={[]}
        pending={false}
        onSet={vi.fn()}
        onRestore={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: /Occurrence date.*Aug 12, 2026/ })).toHaveTextContent(
      'Aug 12, 2026',
    );
  });
});
