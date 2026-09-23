/**
 * `PropertyTrigger` sizes: the compact property-row trigger by default, and the shared control step
 * when a host places it beside buttons on the control scale.
 */
import '@testing-library/jest-dom/vitest';

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { PropertyTrigger } from '../../../src/components/pickers/PropertyTrigger';

describe('PropertyTrigger size', () => {
  it('is the compact row trigger by default', () => {
    render(<PropertyTrigger label="0:30" placeholder="Estimate" ariaLabel="Estimate" />);

    expect(screen.getByRole('button', { name: 'Estimate' })).toHaveClass('h-auto');
  });

  it('takes the control step it is given', () => {
    render(
      <PropertyTrigger label="0:30" placeholder="Estimate" ariaLabel="Estimate" controlSize="xl" />,
    );

    const trigger = screen.getByRole('button', { name: 'Estimate' });
    expect(trigger).toHaveClass('h-10');
    expect(trigger).not.toHaveClass('h-auto');
  });
});
