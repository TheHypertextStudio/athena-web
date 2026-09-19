import '@testing-library/jest-dom/vitest';

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ProjectGraphBar } from '../../../src/components/canvas/project-graph-bar';

afterEach(cleanup);

const chrome = {
  title: 'Projects',
  navigation: <button type="button">Back</button>,
  lensSwitch: <div role="tablist" aria-label="Projects views" />,
};

describe('ProjectGraphBar', () => {
  it('is one named region carrying the title, the way back, the lens switch, and the counts', () => {
    render(
      <ProjectGraphBar
        chrome={chrome}
        counts={{ projects: 3, dependencies: 2 }}
        insetRight={0}
        onHeightChange={vi.fn()}
      />,
    );

    const region = screen.getByRole('region', { name: 'Project dependencies' });
    expect(region).toContainElement(screen.getByRole('heading', { level: 1 }));
    expect(region).toContainElement(screen.getByRole('button', { name: 'Back' }));
    expect(region).toContainElement(screen.getByRole('tablist', { name: 'Projects views' }));
    expect(region).toHaveTextContent('3 projects');
    expect(region).toHaveTextContent('2 dependencies');
  });

  it('counts a single project and a single dependency in the singular', () => {
    render(
      <ProjectGraphBar
        chrome={chrome}
        counts={{ projects: 1, dependencies: 1 }}
        insetRight={0}
        onHeightChange={vi.fn()}
      />,
    );

    const region = screen.getByRole('region', { name: 'Project dependencies' });
    expect(region).toHaveTextContent('1 project');
    expect(region).not.toHaveTextContent('1 projects');
    expect(region).toHaveTextContent('1 dependency');
    expect(region).not.toHaveTextContent('1 dependencies');
  });

  it('opens creation from the New project action, handing back the button to return focus to', () => {
    const onCreate = vi.fn();
    render(
      <ProjectGraphBar
        chrome={chrome}
        counts={{ projects: 0, dependencies: 0 }}
        onCreate={onCreate}
        insetRight={0}
        onHeightChange={vi.fn()}
      />,
    );

    const button = screen.getByRole('button', { name: 'New project' });
    fireEvent.click(button);

    expect(onCreate).toHaveBeenCalledWith(button);
  });

  it('names its title and New project for the roster to morph into', () => {
    render(
      <ProjectGraphBar
        chrome={{
          ...chrome,
          titleTransitionName: 'lens-title',
          createTransitionName: 'lens-create',
        }}
        counts={{ projects: 0, dependencies: 0 }}
        onCreate={vi.fn()}
        insetRight={0}
        onHeightChange={vi.fn()}
      />,
    );

    expect(screen.getByRole('heading', { level: 1 }).style.viewTransitionName).toBe('lens-title');
    expect(screen.getByRole('button', { name: 'New project' }).style.viewTransitionName).toBe(
      'lens-create',
    );
  });

  it('carries no New project action for a viewer who cannot contribute', () => {
    render(
      <ProjectGraphBar
        chrome={chrome}
        counts={{ projects: 0, dependencies: 0 }}
        insetRight={0}
        onHeightChange={vi.fn()}
      />,
    );

    expect(screen.queryByRole('button', { name: 'New project' })).not.toBeInTheDocument();
  });

  it('stops short of a floating inspector and reports its height', () => {
    const onHeightChange = vi.fn();
    render(
      <ProjectGraphBar
        chrome={chrome}
        counts={{ projects: 0, dependencies: 0 }}
        insetRight={292}
        onHeightChange={onHeightChange}
      />,
    );

    const wrapper = screen.getByRole('region', { name: 'Project dependencies' }).parentElement;
    expect(wrapper?.style.right).toBe('300px');
    expect(onHeightChange).toHaveBeenCalledWith(expect.any(Number));
  });
});
