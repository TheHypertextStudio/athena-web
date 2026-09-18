import '@testing-library/jest-dom/vitest';

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Field, FieldError, Input } from '../../src/primitives';

describe('FieldError', () => {
  it('announces application-owned copy under a control Field cannot wrap', () => {
    render(
      <>
        <input aria-label="Address" aria-describedby="address-error" />
        <FieldError id="address-error">Enter a street address.</FieldError>
      </>,
    );

    const error = screen.getByRole('alert');
    expect(error).toHaveAttribute('id', 'address-error');
    expect(error).toHaveTextContent('Enter a street address.');
    expect(screen.getByRole('textbox', { name: 'Address' })).toHaveAccessibleDescription(
      'Enter a street address.',
    );
  });

  it('is what Field renders for its own error', () => {
    render(
      <Field label="Name" error="Enter a name.">
        <Input />
      </Field>,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('Enter a name.');
  });
});
