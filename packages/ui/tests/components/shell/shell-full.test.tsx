import '@testing-library/jest-dom/vitest';

import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { Home } from '../../../src/icons';
import { AppShell } from '../../../src/components/shell/AppShell';
import {
  ContextProvider,
  HUB_CONTEXT,
  useContextState,
  type ActiveContext,
} from '../../../src/components/shell/ContextProvider';
import { ContextSidebar } from '../../../src/components/shell/ContextSidebar';
import { AddOrgButton, GlobalRail, type RailOrg } from '../../../src/components/shell/GlobalRail';
import { RailOrgAvatar } from '../../../src/components/shell/RailOrgAvatar';
import { SidebarNavItem } from '../../../src/components/shell/SidebarNavItem';

const ACME: RailOrg = { id: 'ORG00000000000000000000001', name: 'Acme Co', avatar: null };
const GLOBEX: RailOrg = { id: 'ORG00000000000000000000002', name: 'Globex', avatar: null };
const ORGS: readonly RailOrg[] = [ACME, GLOBEX];

function ctxWrapper(initial: ActiveContext) {
  return function Wrapper({ children }: { children: React.ReactNode }): React.JSX.Element {
    return <ContextProvider initialContext={initial}>{children}</ContextProvider>;
  };
}

describe('ContextProvider / useContextState', () => {
  it('defaults to the Hub with no accent and comfortable density', () => {
    const { result } = renderHook(() => useContextState(), { wrapper: ctxWrapper(HUB_CONTEXT) });
    expect(result.current.isHub).toBe(true);
    expect(result.current.activeOrgId).toBeNull();
    expect(result.current.orgAccent).toBeNull();
    expect(result.current.density).toBe('comfortable');
  });

  it('derives an org accent when an org context is bound', () => {
    const { result } = renderHook(() => useContextState(), { wrapper: ctxWrapper(ACME.id) });
    expect(result.current.isHub).toBe(false);
    expect(result.current.activeOrgId).toBe(ACME.id);
    expect(result.current.orgAccent).toMatch(/^oklch/);
  });

  it('setContext rebinds and setDensity updates density', () => {
    const { result } = renderHook(() => useContextState(), { wrapper: ctxWrapper(HUB_CONTEXT) });
    act(() => {
      result.current.setContext(ACME.id);
    });
    expect(result.current.activeOrgId).toBe(ACME.id);
    act(() => {
      result.current.setDensity('compact');
    });
    expect(result.current.density).toBe('compact');
  });

  it('honors a non-default initial density', () => {
    function Probe(): React.JSX.Element {
      const { density } = useContextState();
      return <span>{density}</span>;
    }
    render(
      <ContextProvider initialDensity="compact">
        <Probe />
      </ContextProvider>,
    );
    expect(screen.getByText('compact')).toBeInTheDocument();
  });

  it('throws when used outside a provider', () => {
    expect(() => renderHook(() => useContextState())).toThrow(
      'useContextState must be used within a <ContextProvider>.',
    );
  });
});

describe('AppShell', () => {
  it('applies --org-accent and data-density when an org is bound', () => {
    const { container } = render(
      <ContextProvider initialContext={ACME.id} initialDensity="compact">
        <AppShell orgs={ORGS}>
          <div>Main</div>
        </AppShell>
      </ContextProvider>,
    );
    const root = container.firstElementChild as HTMLElement;
    expect(root).toHaveAttribute('data-density', 'compact');
    expect(root.style.getPropertyValue('--org-accent')).toMatch(/oklch/);
    expect(screen.getByText('Main')).toBeInTheDocument();
  });

  it('omits the --org-accent variable on the Hub (no bound org)', () => {
    const { container } = render(
      <ContextProvider initialContext={HUB_CONTEXT}>
        <AppShell orgs={ORGS} className="shell-x">
          <div>Hub main</div>
        </AppShell>
      </ContextProvider>,
    );
    const root = container.firstElementChild as HTMLElement;
    expect(root.style.getPropertyValue('--org-accent')).toBe('');
    expect(root).toHaveClass('shell-x');
  });

  it('forwards nav selection from the sidebar', () => {
    const onNavigate = vi.fn();
    render(
      <ContextProvider initialContext={ACME.id}>
        <AppShell orgs={ORGS} activeNavKey="projects" onNavigate={onNavigate}>
          <div>x</div>
        </AppShell>
      </ContextProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Triage' }));
    expect(onNavigate).toHaveBeenCalledWith('triage');
  });
});

describe('GlobalRail', () => {
  it('renders the Hub button (active) and one avatar per org', () => {
    render(
      <ContextProvider initialContext={HUB_CONTEXT}>
        <GlobalRail orgs={ORGS} />
      </ContextProvider>,
    );
    const hub = screen.getByRole('button', { name: 'Hub' });
    expect(hub).toHaveAttribute('aria-current', 'page');
    for (const org of ORGS) {
      expect(screen.getByRole('button', { name: org.name })).toBeInTheDocument();
    }
  });

  it('selecting an org rebinds the context (Hub loses active), and Hub rebinds back', () => {
    render(
      <ContextProvider initialContext={HUB_CONTEXT}>
        <GlobalRail orgs={ORGS} />
      </ContextProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Acme Co' }));
    expect(screen.getByRole('button', { name: 'Acme Co' })).toHaveAttribute('aria-current', 'true');
    expect(screen.getByRole('button', { name: 'Hub' })).not.toHaveAttribute('aria-current');

    fireEvent.click(screen.getByRole('button', { name: 'Hub' }));
    expect(screen.getByRole('button', { name: 'Hub' })).toHaveAttribute('aria-current', 'page');
  });

  it('fires onAddOrg from the add-org affordance', () => {
    const onAddOrg = vi.fn();
    render(
      <ContextProvider>
        <GlobalRail orgs={ORGS} onAddOrg={onAddOrg} />
      </ContextProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Add organization' }));
    expect(onAddOrg).toHaveBeenCalledTimes(1);
  });
});

describe('AddOrgButton', () => {
  it('renders without a handler and does not throw on click', () => {
    render(<AddOrgButton />);
    expect(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Add organization' }));
    }).not.toThrow();
  });
});

describe('RailOrgAvatar', () => {
  it('renders an inactive avatar with initials and selects on click', () => {
    const onSelect = vi.fn();
    render(<RailOrgAvatar orgId={ACME.id} name="Acme Co" onSelect={onSelect} />);
    const btn = screen.getByRole('button', { name: 'Acme Co' });
    expect(btn).not.toHaveAttribute('aria-current');
    expect(btn).not.toHaveAttribute('data-active');
    expect(screen.getByText('AC')).toBeInTheDocument();
    fireEvent.click(btn);
    expect(onSelect).toHaveBeenCalledWith(ACME.id);
  });

  it('renders the active accent ring when active', () => {
    render(<RailOrgAvatar orgId={ACME.id} name="Acme Co" active onSelect={() => undefined} />);
    const btn = screen.getByRole('button', { name: 'Acme Co' });
    expect(btn).toHaveAttribute('aria-current', 'true');
    expect(btn).toHaveAttribute('data-active', '');
    expect(btn).toHaveClass('ring-2');
    expect(btn.style.getPropertyValue('--org-accent')).toMatch(/oklch/);
  });

  it('renders the image branch when an avatarUrl is provided', () => {
    render(
      <RailOrgAvatar
        orgId={ACME.id}
        name="Acme Co"
        avatarUrl="https://example.com/a.png"
        onSelect={() => undefined}
      />,
    );
    // Fallback initials are still present in jsdom.
    expect(screen.getByText('AC')).toBeInTheDocument();
  });

  it('uses "?" initials for a blank name and two-char prefix for a single word', () => {
    const { rerender } = render(<RailOrgAvatar orgId="x" name="   " onSelect={() => undefined} />);
    expect(screen.getByText('?')).toBeInTheDocument();
    rerender(<RailOrgAvatar orgId="x" name="Globex" onSelect={() => undefined} />);
    expect(screen.getByText('GL')).toBeInTheDocument();
  });
});

describe('ContextSidebar', () => {
  it('renders fixed and vocabulary-resolved rows (startup fallback) and highlights the active key', () => {
    render(<ContextSidebar activeKey="projects" onNavigate={() => undefined} />);
    expect(screen.getByRole('button', { name: 'My Work' })).toBeInTheDocument();
    // Vocabulary rows fall back to the startup preset without a VocabularyProvider.
    const projects = screen.getByRole('button', { name: 'Projects' });
    expect(projects).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: 'Cycles' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Teams' })).toBeInTheDocument();
  });

  it('calls onNavigate with the selected key', () => {
    const onNavigate = vi.fn();
    render(<ContextSidebar onNavigate={onNavigate} />);
    fireEvent.click(screen.getByRole('button', { name: 'Agents' }));
    expect(onNavigate).toHaveBeenCalledWith('agents');
  });

  it('renders without an onNavigate handler (rows are not selectable)', () => {
    render(<ContextSidebar />);
    expect(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    }).not.toThrow();
  });
});

describe('SidebarNavItem', () => {
  it('renders a button with an icon and calls onSelect', () => {
    const onSelect = vi.fn();
    render(<SidebarNavItem label="Home" icon={Home} onSelect={onSelect} />);
    const btn = screen.getByRole('button', { name: 'Home' });
    fireEvent.click(btn);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('renders without an icon', () => {
    render(<SidebarNavItem label="Plain" />);
    expect(screen.getByRole('button', { name: 'Plain' })).toBeInTheDocument();
  });

  it('marks the active row with aria-current', () => {
    render(<SidebarNavItem label="Active" active />);
    expect(screen.getByRole('button', { name: 'Active' })).toHaveAttribute('aria-current', 'page');
  });

  it('renders asChild onto a custom link element (active)', () => {
    render(
      <SidebarNavItem label="Linked" asChild active>
        <a href="/dest">Linked</a>
      </SidebarNavItem>,
    );
    const link = screen.getByRole('link', { name: 'Linked' });
    expect(link).toHaveAttribute('aria-current', 'page');
    expect(link).toHaveClass('justify-start');
  });

  it('renders asChild without active (no aria-current)', () => {
    render(
      <SidebarNavItem label="Inactive" asChild>
        <a href="/dest">Inactive</a>
      </SidebarNavItem>,
    );
    expect(screen.getByRole('link', { name: 'Inactive' })).not.toHaveAttribute('aria-current');
  });
});
