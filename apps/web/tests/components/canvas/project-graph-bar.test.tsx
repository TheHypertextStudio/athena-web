import '@testing-library/jest-dom/vitest';

import { TooltipProvider } from '@docket/ui/primitives';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/components/docket-link', () => ({
  default: ({
    href,
    children,
    ...rest
  }: { href: string; children: ReactNode } & Record<string, unknown>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { ProjectGraphBar } from '../../../src/components/canvas/project-graph-bar';
import { PROJECT_LENS_TRANSITION } from '../../../src/components/work-views/project-lens-frame';

const ORG_ID = '01K3CQWKHQ3GXESM7K1YS55P9A';

afterEach(cleanup);

function renderBar(props: Partial<Parameters<typeof ProjectGraphBar>[0]> = {}): void {
  render(
    <TooltipProvider>
      <ProjectGraphBar orgId={ORG_ID} {...props} />
    </TooltipProvider>,
  );
}

describe('ProjectGraphBar', () => {
  it('is one named region carrying the title, the way back, the lens switch, and the counts', () => {
    renderBar({ counts: { projects: 3, dependencies: 2 } });

    const region = screen.getByRole('region', { name: 'Project dependencies' });
    expect(region).toContainElement(screen.getByRole('heading', { level: 1 }));
    expect(region).toContainElement(screen.getByRole('link', { name: /back to projects/i }));
    expect(region).toContainElement(screen.getByRole('tablist', { name: 'Projects views' }));
    expect(region).toHaveTextContent('3 projects');
    expect(region).toHaveTextContent('2 dependencies');
  });

  it('points the way back and the List segment at the roster, morphing into it', () => {
    renderBar();

    const back = screen.getByRole('link', { name: /back to projects/i });
    expect(back).toHaveAttribute('href', `/orgs/${ORG_ID}/projects`);
    expect(back).toHaveAttribute('transition', 'shared-element');
    expect(screen.getByRole('tab', { name: 'List' })).toHaveAttribute(
      'href',
      `/orgs/${ORG_ID}/projects`,
    );
    expect(screen.getByRole('tab', { name: 'Dependencies' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it('carries no counts before there is a graph to count', () => {
    renderBar();

    expect(screen.getByRole('region', { name: 'Project dependencies' })).not.toHaveTextContent(
      /\d+ projects?/,
    );
  });

  it('counts a single project and a single dependency in the singular', () => {
    renderBar({ counts: { projects: 1, dependencies: 1 } });

    const region = screen.getByRole('region', { name: 'Project dependencies' });
    expect(region).toHaveTextContent('1 project');
    expect(region).not.toHaveTextContent('1 projects');
    expect(region).toHaveTextContent('1 dependency');
    expect(region).not.toHaveTextContent('1 dependencies');
  });

  it('opens creation from the New project action, handing back the button to return focus to', () => {
    const onCreate = vi.fn();
    renderBar({ counts: { projects: 0, dependencies: 0 }, onCreate });

    const button = screen.getByRole('button', { name: 'New project' });
    fireEvent.click(button);

    expect(onCreate).toHaveBeenCalledWith(button);
  });

  it('names its title and New project for the roster to morph into', () => {
    renderBar({ counts: { projects: 0, dependencies: 0 }, onCreate: vi.fn() });

    expect(screen.getByRole('heading', { level: 1 }).style.viewTransitionName).toBe(
      PROJECT_LENS_TRANSITION.title,
    );
    expect(screen.getByRole('button', { name: 'New project' }).style.viewTransitionName).toBe(
      PROJECT_LENS_TRANSITION.create,
    );
  });

  it('carries no New project action for a viewer who cannot contribute', () => {
    renderBar({ counts: { projects: 0, dependencies: 0 } });

    expect(screen.queryByRole('button', { name: 'New project' })).not.toBeInTheDocument();
  });

  it('stops short of a floating inspector and reports its height', () => {
    const onHeightChange = vi.fn();
    renderBar({ counts: { projects: 0, dependencies: 0 }, insetRight: 292, onHeightChange });

    const wrapper = screen.getByRole('region', { name: 'Project dependencies' }).parentElement;
    expect(wrapper?.style.right).toBe('300px');
    expect(onHeightChange).toHaveBeenCalledWith(expect.any(Number));
  });
});
