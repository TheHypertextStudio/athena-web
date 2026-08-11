import '@testing-library/jest-dom/vitest';

import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

interface ChildrenProps {
  children: ReactNode;
}

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock('@docket/ui/components', () => ({
  AppBar: ({ navigation }: { navigation: ReactNode }) => <header>{navigation}</header>,
}));

vi.mock('@docket/ui/icons', () => ({ ChevronLeft: () => <svg /> }));

vi.mock('@docket/ui/primitives', () => ({
  Button: ({ children }: ChildrenProps) => <>{children}</>,
  Surface: ({ children }: ChildrenProps) => <div>{children}</div>,
  Tooltip: ({ children }: ChildrenProps) => <>{children}</>,
  TooltipContent: ({ children }: ChildrenProps) => <div>{children}</div>,
  TooltipTrigger: ({ children }: ChildrenProps) => <>{children}</>,
}));

vi.mock('@/components/canvas/task-graph-panel', () => ({
  default: ({ renderChrome }: { renderChrome: (bar: ReactNode) => ReactNode }) => (
    <section>{renderChrome(null)}</section>
  ),
}));

vi.mock('@/components/canvas/use-graph-display', () => ({
  useGraphDisplay: () => ({ display: {}, patchDisplay: vi.fn() }),
}));

vi.mock('@/components/views/use-view-state', () => ({
  useViewState: () => ({ state: {}, setFilters: vi.fn(), setGroupBy: vi.fn() }),
}));

import GraphCanvas from '../../src/app/(app)/orgs/[orgId]/graph/graph-canvas';

afterEach(() => {
  cleanup();
});

describe('GraphCanvas back navigation', () => {
  it('returns an unscoped graph to the served My Work page', () => {
    const { container } = render(<GraphCanvas scope={{ orgId: 'org_1' }} />);
    const link = container.querySelector('a');
    if (!link) throw new Error('Expected the graph canvas back link.');

    expect(link).toHaveAttribute('href', '/orgs/org_1/my-work');
  });
});
