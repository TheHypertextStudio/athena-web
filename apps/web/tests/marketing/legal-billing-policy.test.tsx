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
    expect(screen.getByText(/^Effective November 13, 2026\.$/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Prior policy versions' })).toHaveAttribute(
      'href',
      '/legal/history',
    );
    expect(screen.getByRole('link', { name: 'legal@hypertext.studio' })).toHaveAttribute(
      'href',
      'mailto:legal@hypertext.studio',
    );
    expect(screen.getByRole('heading', { name: 'Governing law' })).toBeInTheDocument();
    const applicability = screen.getByText(/If you used Docket before October 14, 2026/);
    expect(applicability).toHaveTextContent(/prior terms apply until then/);
    expect(applicability).toHaveTextContent(/when you create an account or use the service/);
    const notice = screen.getByText(/before future material changes apply/);
    expect(notice).toHaveTextContent(
      /at least 30 days' notice before future material changes apply/,
    );
    expect(notice).toHaveTextContent(/law or urgent security needs require an earlier change/);
    expect(notice).toHaveTextContent(/do not take away rights or remedies for earlier events/);
  });

  it('separates privacy requests from product support and explains hosted processing', () => {
    render(<PrivacyPage />);
    expect(screen.getByText('Published and effective October 14, 2026.')).toBeInTheDocument();
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

it('distinguishes production history from copies requiring manual erasure review', () => {
  render(<PrivacyPage />);
  const history = screen.getByText(/six hours of recent database history/);
  expect(history).toHaveTextContent(/14-day account recovery period/);
  const copies = screen.getByText(/separate copies that do not expire automatically/);
  expect(copies).toHaveTextContent(/until manually removed/);
  expect(copies).toHaveTextContent(/does not automatically remove it from those copies/);
  expect(copies).toHaveTextContent(/review these separate copies and remove matching information/);
  expect(copies).toHaveTextContent(/unless the law allows or requires us to keep it/);
  expect(copies).not.toHaveTextContent(/branch|staging|preview|environment/i);
});

it('keeps the AI recipient and shared-record limits understandable', () => {
  render(<PrivacyPage />);
  expect(screen.getByText(/Hosted Athena currently uses Google Vertex AI/)).toHaveTextContent(
    /requests and context go to that service and the providers it uses/,
  );
  expect(screen.getByRole('link', { name: 'data-use and retention information' })).toHaveAttribute(
    'href',
    'https://cloud.google.com/vertex-ai/generative-ai/docs/data-governance',
  );
  expect(screen.getByText(/Google processes hosted Athena requests/)).toHaveTextContent(
    /may retain requests and responses for service operation and abuse prevention/,
  );
  expect(screen.getByText(/People and agents can see shared work/)).toHaveTextContent(
    /does not give them access to all your personal records or your personal Athena conversations/,
  );
  expect(screen.getByText(/Account deletion has a 14-day recovery period/)).toHaveTextContent(
    /only active owner of an organization with other members/,
  );
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
    expect(screen.getByRole('navigation', { name: 'Policy versions' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Policy history' })).toHaveAttribute(
      'href',
      '/legal/history',
    );
    expect(screen.getByRole('link', { name: 'Current terms' })).toHaveAttribute('href', '/terms');
    expect(screen.getByText(/secure, support, and improve the service/)).toBeInTheDocument();
  });

  it('retains the prior privacy policy and its original effective date', () => {
    render(<HistoricalPrivacyPage />);
    expect(screen.getByText('Effective September 8, 2026')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Policy history' })).toHaveAttribute(
      'href',
      '/legal/history',
    );
    expect(screen.getByRole('link', { name: 'Current privacy policy' })).toHaveAttribute(
      'href',
      '/privacy',
    );
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
