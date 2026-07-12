import '@testing-library/jest-dom/vitest';

import type { VocabularySkin } from '@docket/types';
import { render, renderHook, screen } from '@testing-library/react';
import * as React from 'react';
import { describe, expect, it } from 'vitest';

import { useVocabulary, VocabularyProvider } from '../../../src/hooks/useVocabulary';
import { AppShell } from '../../../src/components/shell/AppShell';
import { ContextProvider } from '../../../src/components/shell/ContextProvider';
import { Sidebar } from '../../../src/components/shell/Sidebar';
import type { Workspace } from '../../../src/components/shell/workspaces';

const ACME: Workspace = { id: 'ORG00000000000000000000001', name: 'Acme Co' };
const GLOBEX: Workspace = { id: 'ORG00000000000000000000002', name: 'Globex' };
const MOCK_WORKSPACES: readonly Workspace[] = [ACME, GLOBEX];

const AGENCY_SKIN: VocabularySkin = { preset: 'agency' };
const STARTUP_SKIN: VocabularySkin = { preset: 'startup' };

/** A test `renderLink` mirroring the host's Next `Link` (a real anchor). */
function renderLink(href: string, content: React.ReactNode): React.ReactNode {
  return <a href={href}>{content}</a>;
}

describe('AppShell + Sidebar', () => {
  it('renders the integrated sidebar inside the providers, skinned to the active org', () => {
    render(
      <ContextProvider initialContext={ACME.id}>
        <VocabularyProvider skin={AGENCY_SKIN}>
          <AppShell
            sidebar={
              <Sidebar
                workspaces={MOCK_WORKSPACES}
                hrefForHome={(key) => `/${key}`}
                hrefForWorkspace={(orgId, key) => `/orgs/${orgId}/${key}`}
                renderLink={renderLink}
                onSelectWorkspace={() => undefined}
                onCreateWorkspace={() => undefined}
                onOpenSearch={() => undefined}
              />
            }
          >
            <div>Main content</div>
          </AppShell>
        </VocabularyProvider>
      </ContextProvider>,
    );

    expect(screen.getByRole('complementary', { name: 'Navigation' })).toBeInTheDocument();
    // The switcher leads with the active org; the org nav is skinned (agency → "Retainers").
    expect(screen.getByRole('button', { name: /Workspace: Acme Co/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Retainers' })).toBeInTheDocument();
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
