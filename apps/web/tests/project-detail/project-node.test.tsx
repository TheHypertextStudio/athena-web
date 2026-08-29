/**
 * `tests/project-detail` — the dependency canvas's project card.
 *
 * @remarks
 * Two launch findings live in this one component: the card was drawn with a hairline stroke and a
 * drop shadow ("sharp borders, doesn't feel immersive"), and it carried an unlabelled rule under
 * the status chip that nobody could name ("it's unclear what the bars beneath the planned chips
 * are for"). Both are properties of the rendered markup, so both are gated here.
 *
 * The bar test asserts all three of the things the requirement asks for together — a visible
 * reading, a hover tooltip, and an accessible name — because any one alone leaves the bar
 * unexplained for someone using a different input or a screen reader.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { ReactFlowProvider } from '@xyflow/react';
import type { JSX } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import ProjectNode, {
  PROJECT_NODE_SIZE,
  type ProjectNodeData,
} from '@/components/canvas/project-node';
import { SelectionProvider } from '@/components/selection';

afterEach(cleanup);

/** Render one project card with the given data. */
function renderNode(overrides: Partial<ProjectNodeData> = {}): { container: HTMLElement } {
  const data: ProjectNodeData = {
    name: 'Payments migration',
    orgId: 'org-1',
    status: 'planned',
    health: 'at_risk',
    progress: 38,
    taskCount: 8,
    completedTaskCount: 3,
    targetDate: '2026-05-14',
    waitingCount: 0,
    density: 'full',
    ...overrides,
  };
  const Node = ProjectNode as unknown as (props: {
    id: string;
    data: ProjectNodeData;
    selected: boolean;
  }) => JSX.Element;
  return render(
    <SelectionProvider
      items={[
        {
          kind: 'project',
          id: 'p-1',
          organizationId: data.orgId,
          title: data.name,
          meta: { taskCount: data.taskCount },
        },
      ]}
      organizationId={data.orgId}
      actionScope="all"
    >
      <ReactFlowProvider>
        <Node id="p-1" data={data} selected={false} />
      </ReactFlowProvider>
    </SelectionProvider>,
  );
}

describe('the card separates itself by tone, not by a stroke', () => {
  it('publishes Project identity and Task count to the shared object interaction layer', () => {
    const { container } = renderNode();
    const card = container.querySelector('[data-object-kind="project"]');
    if (!(card instanceof HTMLElement)) throw new Error('expected the object target');

    expect(card.dataset['objectId']).toBe('p-1');
    expect(card.dataset['objectOrg']).toBe('org-1');
    expect(card.dataset['objectTitle']).toBe('Payments migration');
    expect(JSON.parse(card.dataset['objectMeta'] ?? '{}')).toEqual({ taskCount: 8 });
  });

  it('uses the exported size contract consumed by Project graph layout', () => {
    const { container } = renderNode();
    const card = container.querySelector('[style*="view-transition-name"]');
    if (!(card instanceof HTMLElement)) throw new Error('expected the card root');

    expect(card).toHaveStyle({
      width: `${String(PROJECT_NODE_SIZE.full.width)}px`,
      height: `${String(PROJECT_NODE_SIZE.full.height)}px`,
    });
  });

  it('renders no border utility and no shadow anywhere in the card', () => {
    const { container } = renderNode();
    // `getAttribute`, not `.className`: SVG elements expose an `SVGAnimatedString` there, and the
    // card's status glyph is an SVG.
    for (const element of container.querySelectorAll('*')) {
      const classes = element.getAttribute('class') ?? '';
      expect(classes).not.toMatch(/\bborder(?:-[a-z]|\b)/);
      expect(classes).not.toMatch(/\bshadow-(?!none)/);
    }
    const card = container.querySelector('[style*="view-transition-name"]');
    if (!(card instanceof HTMLElement)) throw new Error('expected the card root');
    expect(card.className).toContain('bg-surface-container-high');
  });

  it('carries the waiting state as a leading accent rather than a coloured outline', () => {
    const { container } = renderNode({ waitingCount: 2 });
    expect(screen.getByText('2 waiting')).toBeTruthy();
    const accent = container.querySelector('.bg-state-started\\/70');
    expect(accent).not.toBeNull();
  });
});

describe('the progress bar says what it measures', () => {
  it('shows a visible reading, a hover tooltip, and an accessible name, all agreeing', () => {
    const { container } = renderNode();
    // The visible reading, right beside the bar.
    expect(screen.getByText('3/8 tasks')).toBeTruthy();

    const bar = container.querySelector('[role="progressbar"]');
    if (!(bar instanceof HTMLElement)) throw new Error('expected a progress bar');
    expect(bar.getAttribute('aria-label')).toBe('3 of 8 tasks complete (38%)');

    // The tooltip is on the group so hovering the reading or the bar both surface it.
    const tooltipHost = bar.closest('[title]');
    if (!(tooltipHost instanceof HTMLElement)) throw new Error('expected a hover tooltip');
    expect(tooltipHost.getAttribute('title')).toBe('3 of 8 tasks complete (38%)');
  });

  it('says "No tasks" rather than drawing an empty rule for a project with none', () => {
    const { container } = renderNode({ taskCount: 0, completedTaskCount: 0, progress: 0 });
    expect(screen.getByText('No tasks')).toBeTruthy();
    const bar = container.querySelector('[role="progressbar"]');
    expect(bar?.getAttribute('aria-label')).toBe('No tasks yet');
  });
});
