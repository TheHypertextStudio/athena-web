import { render, screen } from '@testing-library/react';
import { ReactFlowProvider, Position } from '@xyflow/react';
import { describe, expect, it } from 'vitest';

import {
  PlanDependencyHandle,
  PlanStateChip,
  planCardClasses,
  planHandleClasses,
} from '../../src/components/plan-canvas/plan-status';

describe('PlanStateChip', () => {
  it('marks a draft in the accent and a created node with its check', () => {
    const { rerender } = render(<PlanStateChip status="draft" />);
    const draft = screen.getByText(/draft/i);
    expect(draft).toHaveAttribute('data-plan-state', 'draft');
    expect(draft.querySelector('svg')).toBeNull();
    rerender(<PlanStateChip status="confirmed" />);
    const created = screen.getByText(/created/i);
    expect(created).toHaveAttribute('data-plan-state', 'confirmed');
    expect(created.querySelector('svg')).not.toBeNull();
  });
});

describe('planCardClasses', () => {
  it('draws the dashed outline on a draft card and leaves a row to its glyph', () => {
    expect(planCardClasses('draft', false, false)).toContain('border-dashed');
    expect(planCardClasses('draft', false, false, 'row')).not.toContain('border-dashed');
    expect(planCardClasses('confirmed', false, false)).not.toContain('border-dashed');
  });

  it('adds the arrival motion and the selection ring', () => {
    const classes = planCardClasses('confirmed', true, true, 'row');
    expect(classes).toContain('plan-node-enter');
    expect(classes).toContain('ring-2');
  });
});

describe('PlanDependencyHandle', () => {
  it('names what dragging it does and rests hidden until its node is hovered', () => {
    render(
      <ReactFlowProvider>
        <div className="group">
          <PlanDependencyHandle
            id="dep-out"
            type="source"
            position={Position.Bottom}
            size="!size-2"
          />
        </div>
      </ReactFlowProvider>,
    );
    const handle = screen.getByLabelText(/drag to add a dependency/i);
    expect(handle).toHaveAttribute('title', 'Drag to add a dependency');
    expect(handle).toHaveAttribute('data-handleid', 'dep-out');
    expect(handle.className).toContain('opacity-0');
    expect(handle.className).toContain(planHandleClasses('!size-2').split(' ')[0] ?? '');
  });
});
