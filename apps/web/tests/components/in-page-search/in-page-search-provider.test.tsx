import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { type JSX, useRef, useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import {
  InPageSearchProvider,
  useInPageSearchTarget,
} from '@/components/in-page-search/in-page-search-provider';

afterEach(cleanup);

interface TargetProps {
  readonly id: string;
  readonly children?: React.ReactNode;
  readonly enabled?: boolean;
  readonly brokenFocus?: boolean;
  readonly inputOutsideRoot?: boolean;
}

function Target({
  id,
  children,
  enabled = true,
  brokenFocus = false,
  inputOutsideRoot = false,
}: TargetProps): JSX.Element {
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { restoreFocus } = useInPageSearchTarget({ id, rootRef, inputRef, enabled });

  const input = (
    <input
      ref={(element) => {
        inputRef.current = element;
        if (element && brokenFocus) element.focus = (): void => undefined;
      }}
      aria-label={`${id} search`}
      defaultValue={`${id} query`}
      onKeyDown={(event) => {
        if (event.key === 'Escape') restoreFocus();
      }}
    />
  );

  return (
    <>
      {inputOutsideRoot ? input : null}
      <div ref={rootRef}>
        <button type="button">{id} action</button>
        {inputOutsideRoot ? null : input}
        <button type="button" onClick={restoreFocus}>
          Restore {id} focus
        </button>
        {children}
      </div>
    </>
  );
}

describe('InPageSearchProvider', () => {
  it.each([
    { modifier: 'Control', event: { ctrlKey: true } },
    { modifier: 'Meta', event: { metaKey: true } },
  ])('$modifier+F focuses and selects the registered search field', ({ event }) => {
    render(
      <InPageSearchProvider>
        <Target id="library" />
      </InPageSearchProvider>,
    );
    const input = screen.getByRole<HTMLInputElement>('textbox', { name: 'library search' });

    const shortcut = fireEvent.keyDown(document, { key: 'f', ...event });

    expect(shortcut).toBe(false);
    expect(input).toHaveFocus();
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(input.value.length);
  });

  it.each([
    { name: 'repeat', event: { ctrlKey: true, repeat: true } },
    { name: 'Alt modifier', event: { ctrlKey: true, altKey: true } },
    { name: 'both platform modifiers', event: { ctrlKey: true, metaKey: true } },
  ])('leaves native find alone for $name events', ({ event }) => {
    render(
      <InPageSearchProvider>
        <Target id="library" />
      </InPageSearchProvider>,
    );

    const shortcut = fireEvent.keyDown(document, { key: 'f', ...event });

    expect(shortcut).toBe(true);
    expect(screen.getByRole('textbox', { name: 'library search' })).not.toHaveFocus();
  });

  it('leaves native find alone when no target is registered', () => {
    render(
      <InPageSearchProvider>
        <main>No virtual collection</main>
      </InPageSearchProvider>,
    );

    expect(fireEvent.keyDown(document, { key: 'f', ctrlKey: true })).toBe(true);
  });

  it('prefers the deepest target that contains the current focus', () => {
    render(
      <InPageSearchProvider>
        <Target id="page">
          <Target id="dialog" />
        </Target>
      </InPageSearchProvider>,
    );
    screen.getByRole('button', { name: 'dialog action' }).focus();

    fireEvent.keyDown(document, { key: 'f', metaKey: true });

    expect(screen.getByRole('textbox', { name: 'dialog search' })).toHaveFocus();
  });

  it('prefers the last-focused sibling when focus has moved outside both targets', () => {
    render(
      <InPageSearchProvider>
        <button type="button">Outside</button>
        <Target id="first" />
        <Target id="second" />
      </InPageSearchProvider>,
    );
    screen.getByRole('button', { name: 'first action' }).focus();
    screen.getByRole('button', { name: 'second action' }).focus();
    screen.getByRole('button', { name: 'Outside' }).focus();

    fireEvent.keyDown(document, { key: 'f', ctrlKey: true });

    expect(screen.getByRole('textbox', { name: 'second search' })).toHaveFocus();
  });

  it('keeps a target active while its registered field is outside the surface root', () => {
    render(
      <InPageSearchProvider>
        <Target id="other" />
        <Target id="library" inputOutsideRoot />
      </InPageSearchProvider>,
    );
    const library = screen.getByRole<HTMLInputElement>('textbox', { name: 'library search' });
    library.focus();

    fireEvent.keyDown(document, { key: 'f', metaKey: true });

    expect(library).toHaveFocus();
    expect(library.selectionStart).toBe(0);
    expect(library.selectionEnd).toBe(library.value.length);
  });

  it('unregisters a target when its component closes', () => {
    function Fixture(): JSX.Element {
      const [open, setOpen] = useState(true);
      return (
        <InPageSearchProvider>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
            }}
          >
            Close
          </button>
          {open ? <Target id="dialog" /> : null}
        </InPageSearchProvider>
      );
    }
    render(<Fixture />);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    expect(fireEvent.keyDown(document, { key: 'f', ctrlKey: true })).toBe(true);
  });

  it('falls back when a higher-priority target cannot take focus', () => {
    render(
      <InPageSearchProvider>
        <Target id="fallback" />
        <Target id="broken" brokenFocus />
      </InPageSearchProvider>,
    );
    screen.getByRole('button', { name: 'broken action' }).focus();

    fireEvent.keyDown(document, { key: 'f', ctrlKey: true });

    expect(screen.getByRole('textbox', { name: 'fallback search' })).toHaveFocus();
  });

  it('restores the connected element that preceded a successful command', () => {
    render(
      <InPageSearchProvider>
        <button type="button">Before search</button>
        <Target id="library" />
      </InPageSearchProvider>,
    );
    const prior = screen.getByRole('button', { name: 'Before search' });
    prior.focus();
    fireEvent.keyDown(document, { key: 'f', ctrlKey: true });

    fireEvent.click(screen.getByRole('button', { name: 'Restore library focus' }));

    expect(prior).toHaveFocus();
  });

  it('blurs the search field when the prior element cannot retake focus', () => {
    render(
      <InPageSearchProvider>
        <Target id="library" />
      </InPageSearchProvider>,
    );
    fireEvent.keyDown(document, { key: 'f', ctrlKey: true });
    const input = screen.getByRole('textbox', { name: 'library search' });
    expect(input).toHaveFocus();

    fireEvent.keyDown(input, { key: 'Escape' });

    expect(input).not.toHaveFocus();
  });
});
