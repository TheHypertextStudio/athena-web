import '@testing-library/jest-dom/vitest';

import type { VocabularySkin } from '@docket/types';
import { render, renderHook, screen } from '@testing-library/react';
import * as React from 'react';
import { describe, expect, it } from 'vitest';

import { useVocabulary, VocabularyProvider } from '../../hooks/useVocabulary';
import { AppShell } from './AppShell';
import { ContextProvider } from './ContextProvider';
import type { RailOrg } from './GlobalRail';

const ACME: RailOrg = { id: 'ORG00000000000000000000001', name: 'Acme Co', avatar: null };
const GLOBEX: RailOrg = { id: 'ORG00000000000000000000002', name: 'Globex', avatar: null };
const MOCK_ORGS: readonly RailOrg[] = [ACME, GLOBEX];

const AGENCY_SKIN: VocabularySkin = { preset: 'agency' };
const STARTUP_SKIN: VocabularySkin = { preset: 'startup' };

describe('AppShell', () => {
  it('renders the GlobalRail and ContextSidebar regions inside the providers', () => {
    render(
      <ContextProvider initialContext={ACME.id}>
        <VocabularyProvider skin={AGENCY_SKIN}>
          <AppShell orgs={MOCK_ORGS}>
            <div>Main content</div>
          </AppShell>
        </VocabularyProvider>
      </ContextProvider>,
    );

    expect(screen.getByRole('navigation', { name: 'Organizations' })).toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: 'Navigation' })).toBeInTheDocument();

    // The rail renders the Hub button plus one avatar button per mock org.
    expect(screen.getByRole('button', { name: 'Hub' })).toBeInTheDocument();
    for (const org of MOCK_ORGS) {
      expect(screen.getByRole('button', { name: org.name })).toBeInTheDocument();
    }

    expect(screen.getByText('Main content')).toBeInTheDocument();
  });
});

describe('useVocabulary', () => {
  it("resolves 'program' to 'Program' under the startup preset", () => {
    const { result } = renderHook(() => useVocabulary('program'), {
      wrapper: ({ children }: { children: React.ReactNode }) => (
        <VocabularyProvider skin={STARTUP_SKIN}>{children}</VocabularyProvider>
      ),
    });
    expect(result.current).toBe('Program');
  });

  it("resolves 'program' to 'Retainer' under the agency preset", () => {
    const { result } = renderHook(() => useVocabulary('program'), {
      wrapper: ({ children }: { children: React.ReactNode }) => (
        <VocabularyProvider skin={AGENCY_SKIN}>{children}</VocabularyProvider>
      ),
    });
    expect(result.current).toBe('Retainer');
  });

  it('falls back to the startup preset when no provider is present (Hub)', () => {
    const { result } = renderHook(() => useVocabulary('program'));
    expect(result.current).toBe('Program');
  });

  it('honors a per-key override above the preset', () => {
    const overridden: VocabularySkin = {
      preset: 'agency',
      overrides: { program: { singular: 'Account', plural: 'Accounts' } },
    };
    const { result } = renderHook(() => useVocabulary('program', { plural: true }), {
      wrapper: ({ children }: { children: React.ReactNode }) => (
        <VocabularyProvider skin={overridden}>{children}</VocabularyProvider>
      ),
    });
    expect(result.current).toBe('Accounts');
  });
});
