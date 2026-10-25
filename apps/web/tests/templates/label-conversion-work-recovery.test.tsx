import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ConversionWorkPicker } from '@/components/templates/label-conversion/work-picker';
vi.mock('@/lib/query', () => ({
  useApiQuery: () => ({ isError: true, error: new Error('Unavailable') }),
}));
vi.mock('@/components/templates/label-conversion/queries', () => ({
  conversionWorkDef: () => ({ queryKey: ['work'] }),
}));
vi.mock('@/components/feedback', () => ({ QueryLoadFailure: () => <button>Try again</button> }));
afterEach(cleanup);
it('brings the owned matching-work recovery into view after the request fails', () => {
  const scroll = vi.fn();
  const previous = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView');
  HTMLElement.prototype.scrollIntoView = scroll;
  try {
    render(
      <ConversionWorkPicker
        orgId="01ARZ3NDEKTSV4RRFFQ69G5FAV"
        kind="project"
        labelId="01ARZ3NDEKTSV4RRFFQ69G5FAW"
        selected={[]}
        disabled={false}
        onChange={vi.fn()}
      />,
    );
    const recovery = screen.getByRole('region', { name: 'Matching work could not load' });
    expect(recovery).toHaveFocus();
    expect(recovery).toContainElement(screen.getByRole('button', { name: 'Try again' }));
    expect(scroll).toHaveBeenCalledWith({ block: 'center' });
  } finally {
    if (previous) Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', previous);
    else Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
  }
});
