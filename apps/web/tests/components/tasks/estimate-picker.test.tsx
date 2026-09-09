import '@testing-library/jest-dom/vitest';

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { EstimatePicker } from '@/components/task-detail/EstimatePicker';

describe('EstimatePicker', () => {
  it('lets a composer own the empty-state copy', () => {
    render(
      <EstimatePicker
        scale="fibonacci"
        value={null}
        onChange={vi.fn()}
        placeholder="No estimate"
      />,
    );

    expect(screen.getByRole('button', { name: 'Estimate — not set' })).toHaveTextContent(
      'No estimate',
    );
  });
});
