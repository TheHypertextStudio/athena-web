import '@testing-library/jest-dom/vitest';

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AuthLayout } from '../../../src/components/auth/AuthLayout';

describe('AuthLayout', () => {
  it('renders the brand, intro, and children in the context/action split', () => {
    render(
      <AuthLayout brand={<span data-testid="brand">Docket</span>} intro={<h1>Welcome back</h1>}>
        <button type="button">Continue with a passkey</button>
      </AuthLayout>,
    );
    expect(screen.getByTestId('brand')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Welcome back' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue with a passkey' })).toBeInTheDocument();
    // The auth tree renders its own <main>, independent of any app shell.
    expect(screen.getByRole('main')).toBeInTheDocument();
  });

  it('merges an extra className onto the card', () => {
    render(
      <AuthLayout brand={<span>Docket</span>} intro={<h1>Sign in</h1>} className="card-x">
        <div>form</div>
      </AuthLayout>,
    );
    const card = screen.getByText('form').closest('.card-x');
    expect(card).not.toBeNull();
  });
});
