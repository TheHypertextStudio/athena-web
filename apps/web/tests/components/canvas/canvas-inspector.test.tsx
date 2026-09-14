import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { assertDefined } from '@docket/test-utils';

import { CanvasInspector } from '@/components/canvas/canvas-inspector';

function renderFrame(): HTMLElement {
  render(
    <CanvasInspector
      title="Matching gift"
      closeLabel="Close project details"
      onClose={vi.fn()}
      footer={<button type="button">Confirm</button>}
    >
      <p>Body</p>
    </CanvasInspector>,
  );
  return assertDefined(screen.getByText('Body').parentElement);
}

/** Give the jsdom body the metrics of a scrollable element. */
function pretendScrollable(body: HTMLElement, scrollTop: number): void {
  Object.defineProperty(body, 'scrollHeight', { configurable: true, value: 600 });
  Object.defineProperty(body, 'clientHeight', { configurable: true, value: 300 });
  Object.defineProperty(body, 'scrollTop', {
    configurable: true,
    value: scrollTop,
    writable: true,
  });
}

describe('CanvasInspector', () => {
  it('pins the footer below the body so its action stays reachable', () => {
    renderFrame();
    const footer = screen.getByRole('button', { name: 'Confirm' }).parentElement;
    expect(footer).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Close project details' })).toBeInTheDocument();
  });

  it('steps the header and footer tone as content runs under them', () => {
    const body = renderFrame();
    const header = screen.getByRole('button', { name: 'Close project details' }).parentElement;
    const footer = screen.getByRole('button', { name: 'Confirm' }).parentElement;
    pretendScrollable(body, 0);
    fireEvent.scroll(body);
    expect(header).not.toHaveAttribute('data-scrolled');
    expect(footer).toHaveAttribute('data-scrolled', 'true');

    pretendScrollable(body, 300);
    fireEvent.scroll(body);
    expect(header).toHaveAttribute('data-scrolled', 'true');
    expect(footer).not.toHaveAttribute('data-scrolled');
  });
});
