import '@testing-library/jest-dom/vitest';

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { useInputModality } from '../../src/hooks/use-input-modality';

/** Renders the current modality so a test can read it out of the DOM. */
function Probe(): React.JSX.Element {
  return <output>{useInputModality()}</output>;
}

describe('useInputModality', () => {
  beforeEach(() => {
    // Modality is a property of the reader, not of a component, so it is deliberately shared
    // process-wide. Each test states which device it is holding.
    fireEvent.pointerDown(document);
  });

  it('starts on the pointer so nothing mounts already ringed', () => {
    render(<Probe />);
    expect(screen.getByRole('status')).toHaveTextContent('pointer');
  });

  it('switches to the keyboard on a key press and back on pointer movement', () => {
    render(<Probe />);
    const probe = screen.getByRole('status');

    fireEvent.keyDown(document, { key: 'ArrowDown' });
    expect(probe).toHaveTextContent('keyboard');

    fireEvent.pointerMove(document);
    expect(probe).toHaveTextContent('pointer');
  });

  it('ignores a modifier held on its own but not the chord it completes', () => {
    render(<Probe />);
    const probe = screen.getByRole('status');

    // Holding a modifier is not yet navigating, and it repeats while held.
    for (const key of ['Meta', 'Shift', 'Control', 'Alt']) {
      fireEvent.keyDown(document, { key });
      expect(probe, key).toHaveTextContent('pointer');
    }

    // Pasting a query into a picker's search field is keyboard input like any other.
    fireEvent.keyDown(document, { key: 'v', metaKey: true });
    expect(probe).toHaveTextContent('keyboard');
  });

  it('keeps watching the pointer across a gap with no subscribers', () => {
    // The click that opens a menu lands before the menu mounts, so a hook that only listened
    // while subscribed would report the modality left over from before it.
    const first = render(<Probe />);
    fireEvent.keyDown(document, { key: 'ArrowDown' });
    first.unmount();

    fireEvent.pointerDown(document);
    render(<Probe />);
    expect(screen.getByRole('status')).toHaveTextContent('pointer');
  });

  it('reports one shared value to every subscriber', () => {
    render(
      <>
        <Probe />
        <Probe />
      </>,
    );

    fireEvent.keyDown(document, { key: 'a' });
    for (const probe of screen.getAllByRole('status')) {
      expect(probe).toHaveTextContent('keyboard');
    }
  });
});
