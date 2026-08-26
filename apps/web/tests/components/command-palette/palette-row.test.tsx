import '@testing-library/jest-dom/vitest';

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { PaletteRow } from '@/components/command-palette/palette-row';
import { CheckCircle2 } from '@docket/ui/icons';

describe('PaletteRow', () => {
  it('uses one secondary context line without repeating the result type', () => {
    render(
      <PaletteRow
        item={{
          id: 'hit:security-review',
          section: 'results',
          label: 'Security review',
          hint: 'Quarterly access audit',
          icon: CheckCircle2,
          org: { id: 'org_personal', name: 'Personal' },
          source: 'Docket',
          run: vi.fn(),
        }}
        active={false}
        rowId="security-review"
        onSelect={vi.fn()}
        onHover={vi.fn()}
      />,
    );

    expect(screen.getByText('Security review')).toHaveClass('truncate');
    expect(screen.getByTestId('palette-row-context')).toHaveTextContent(
      'Quarterly access auditPersonalDocket',
    );
    expect(screen.queryByText('Task')).not.toBeInTheDocument();
  });
});
