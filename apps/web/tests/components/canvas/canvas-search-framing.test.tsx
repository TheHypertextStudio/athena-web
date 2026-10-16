import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

const flow = vi.hoisted(() => ({
  fitView: vi.fn().mockResolvedValue(true),
  getNodesBounds: vi.fn().mockReturnValue({ x: 480, y: 160, width: 368, height: 144 }),
  lookup: new Map<string, { measured: { width?: number; height?: number }; hidden?: boolean }>(),
}));
vi.mock('@xyflow/react', () => ({
  useReactFlow: () => ({ fitView: flow.fitView, getNodesBounds: flow.getNodesBounds }),
  useStore: <T,>(selector: (state: { nodeLookup: typeof flow.lookup }) => T): T =>
    selector({ nodeLookup: flow.lookup }),
  useNodesState: vi.fn(),
  useEdgesState: vi.fn(),
}));
import { useFitViewOnChange } from '@/components/canvas/use-controlled-flow';
afterEach(() => {
  cleanup();
  flow.fitView.mockClear();
  flow.lookup.clear();
});

it('waits for the matched node to be measured before framing search results', () => {
  flow.lookup.set('invitation', { measured: {} });
  const ids = ['invitation'];
  const hook = renderHook(() => {
    useFitViewOnChange(ids, 1, true, 0.2);
  });
  expect(flow.fitView).not.toHaveBeenCalled();
  flow.lookup.set('invitation', { measured: { width: 368, height: 144 } });
  hook.rerender();
  expect(flow.fitView).toHaveBeenCalledOnce();
  expect(flow.fitView).toHaveBeenCalledWith(
    expect.objectContaining({ nodes: [{ id: 'invitation' }], maxZoom: 1, padding: 0.2 }),
  );
});

it('waits for expanded matches to be visible and leaves unrelated nodes out of the fit', () => {
  flow.lookup.set('invitation', { measured: { width: 304, height: 32 }, hidden: true });
  flow.lookup.set('other', { measured: {} });
  const ids = ['invitation'];
  const hook = renderHook(() => {
    useFitViewOnChange(ids, 1);
  });
  expect(flow.fitView).not.toHaveBeenCalled();
  flow.lookup.set('invitation', { measured: { width: 304, height: 32 }, hidden: false });
  hook.rerender();
  expect(flow.fitView).toHaveBeenCalledOnce();
});
