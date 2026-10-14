import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import AboutPage from '@/app/(marketing)/about/page';
import PrivacyPage from '@/app/(marketing)/privacy/page';
import LegalHistoryPage from '@/app/(marketing)/legal/history/page';
import HistoricalTermsPage from '@/app/(marketing)/legal/history/terms-2026-08-28/page';
import HistoricalPrivacyPage from '@/app/(marketing)/legal/history/privacy-2026-09-08/page';
import TermsPage from '@/app/(marketing)/terms/page';
import { SUPPORT_EMAIL } from '@/lib/support-contact';

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

describe('Studio legal policy navigation and contacts', () => {
  it('gives prospective terms dates and links to prior versions', () => {
    render(<TermsPage />);
    expect(screen.getByText(/^Published October 14, 2026\.$/i)).toBeInTheDocument();
    expect(
      screen.getByText(/^Effective for existing users November 13, 2026/i),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Prior policy versions' })).toHaveAttribute(
      'href',
      '/legal/history',
    );
    expect(screen.getByRole('link', { name: 'legal@hypertext.studio' })).toHaveAttribute(
      'href',
      'mailto:legal@hypertext.studio',
    );
    expect(screen.getByRole('heading', { name: 'Governing law' })).toBeInTheDocument();
  });

  it('separates privacy requests from product support and explains hosted processing', () => {
    render(<PrivacyPage />);
    expect(screen.getByRole('link', { name: /^contact@/ })).toHaveAttribute(
      'href',
      expect.stringMatching(/^mailto:contact@/),
    );
    expect(screen.getByRole('link', { name: SUPPORT_EMAIL })).toHaveAttribute(
      'href',
      `mailto:${SUPPORT_EMAIL}`,
    );
    expect(screen.getByRole('link', { name: 'legal@hypertext.studio' })).toHaveAttribute(
      'href',
      'mailto:legal@hypertext.studio',
    );
    expect(screen.getByRole('link', { name: 'Prior policy versions' })).toHaveAttribute(
      'href',
      '/legal/history',
    );
    expect(
      screen.getByRole('heading', { name: 'Local and hosted processing' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Recipients and AI' })).toBeInTheDocument();
  });
});

describe('prior policy versions', () => {
  it('links to complete dated archives from the stable history page', () => {
    render(<LegalHistoryPage />);
    expect(screen.getByRole('link', { name: 'Terms effective August 28, 2026' })).toHaveAttribute(
      'href',
      '/legal/history/terms-2026-08-28',
    );
    expect(
      screen.getByRole('link', { name: 'Privacy policy effective September 8, 2026' }),
    ).toHaveAttribute('href', '/legal/history/privacy-2026-09-08');
  });

  it('retains the prior terms and their original effective date', () => {
    render(<HistoricalTermsPage />);
    expect(screen.getByText('Effective August 28, 2026')).toBeInTheDocument();
    expect(screen.getByText(/secure, support, and improve the service/)).toBeInTheDocument();
  });

  it('retains the prior privacy policy and its original effective date', () => {
    render(<HistoricalPrivacyPage />);
    expect(screen.getByText('Effective September 8, 2026')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Google user data' })).toBeInTheDocument();
  });
});

it('routes about-page inquiries, product help, and privacy requests to their own contacts', () => {
  render(<AboutPage />);
  expect(screen.getByRole('link', { name: /^contact@/ })).toHaveAttribute(
    'href',
    expect.stringMatching(/^mailto:contact@/),
  );
  expect(screen.getByRole('link', { name: SUPPORT_EMAIL })).toHaveAttribute(
    'href',
    `mailto:${SUPPORT_EMAIL}`,
  );
  expect(screen.getByRole('link', { name: 'legal@hypertext.studio' })).toHaveAttribute(
    'href',
    'mailto:legal@hypertext.studio',
  );
});
