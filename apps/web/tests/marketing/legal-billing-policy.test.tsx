import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import TermsPage from '@/app/(marketing)/terms/page';

describe('public billing terms', () => {
  it('separates Pro cancellation from the confirmed account-deletion flow', () => {
    render(<TermsPage />);

    expect(screen.getByText(/one 14-day trial/i)).toBeInTheDocument();
    expect(screen.getByText(/After that date, shared work becomes read-only/i)).toBeInTheDocument();
    expect(screen.getByText(/seven-day recovery deadline/i)).toBeInTheDocument();
    expect(screen.getByText(/does not delete workspace data when Pro ends/i)).toBeInTheDocument();
    expect(screen.queryByText(/workspace enters deletion/i)).not.toBeInTheDocument();
  });
});
