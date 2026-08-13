import '@testing-library/jest-dom/vitest';

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { SelectionProvider } from '../../src/components/selection/selection-context';
import { InteractionProvider } from '../../src/lib/actions/interaction-provider';

import { TaskList, taskRef } from './harness';

afterEach(() => {
  cleanup();
  window.getSelection()?.removeAllRanges();
});

const ITEMS = [taskRef('1'), taskRef('2'), taskRef('3')];

/** What a dispatched copy event reported back. */
interface CopyResult {
  /** Whether the app claimed the event instead of leaving the browser's own copy alone. */
  readonly claimed: boolean;
  /** The flavors written, by MIME type. */
  readonly flavors: Readonly<Record<string, string>>;
}

/**
 * Dispatch a `copy` and report what the app did with it.
 *
 * @remarks
 * jsdom implements no `DataTransfer`, and the assertion that matters most is a *negative* one —
 * that the event was left alone — so the stand-in records writes and the caller checks
 * `defaultPrevented`.
 */
function copy(target: EventTarget): CopyResult {
  const flavors: Record<string, string> = {};
  const event = new Event('copy', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', {
    value: {
      setData: (type: string, value: string) => {
        flavors[type] = value;
      },
      getData: (type: string) => flavors[type] ?? '',
    },
  });
  target.dispatchEvent(event);
  return { claimed: event.defaultPrevented, flavors };
}

/** Select the full contents of an element, the way a drag across it would. */
function selectContentsOf(element: Element): void {
  const range = document.createRange();
  range.selectNodeContents(element);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

/** Render the documented list surface inside the app's interaction providers. */
function renderList() {
  return render(
    <InteractionProvider>
      <SelectionProvider items={ITEMS} surfaceId="tasks" organizationId="org1">
        <TaskList items={ITEMS} />
      </SelectionProvider>
    </InteractionProvider>,
  );
}

/**
 * ⌘C belongs to text. Claiming it is only defensible where the browser's own answer would be an
 * empty string, so the refusals below are as load-bearing as the copies — a handler that grabs a
 * real text selection would be a regression no amount of Markdown fidelity makes up for.
 */
describe('copying a focused object', () => {
  it('copies the focused row as a linked title in both flavors', () => {
    renderList();
    const row = screen.getByTestId('row-2');
    row.focus();

    const { claimed, flavors } = copy(row);

    expect(claimed).toBe(true);
    expect(flavors['text/plain']).toBe(`[Task 2](${window.location.origin}/orgs/org1/tasks/2)`);
    expect(flavors['text/html']).toContain(`href="${window.location.origin}/orgs/org1/tasks/2"`);
  });

  it('copies the whole selection when the focused row is part of one', () => {
    renderList();
    fireEvent.click(screen.getByTestId('row-1'));
    fireEvent.click(screen.getByTestId('row-3'), { shiftKey: true });

    const { claimed, flavors } = copy(screen.getByTestId('row-3'));

    expect(claimed).toBe(true);
    expect(flavors['text/plain']?.split('\n')).toHaveLength(3);
    expect(flavors['text/plain']?.startsWith('- [Task 1]')).toBe(true);
  });

  it('leaves the event alone when nothing is focused and nothing is selected', () => {
    renderList();

    expect(copy(document.body).claimed).toBe(false);
  });
});

describe('copying rendered Markdown', () => {
  it('copies a selection inside rendered Markdown as Markdown', () => {
    render(
      <InteractionProvider>
        <div data-static-markdown="">
          <h1>Rollout plan</h1>
          <ul>
            <li>
              <p>Flip the flag</p>
            </li>
          </ul>
        </div>
      </InteractionProvider>,
    );
    const container = document.querySelector('[data-static-markdown]');
    if (container === null) throw new Error('rendered Markdown container is missing');
    selectContentsOf(container);

    const { claimed, flavors } = copy(container);

    expect(claimed).toBe(true);
    expect(flavors['text/plain']).toBe('# Rollout plan\n\n- Flip the flag');
  });

  it('leaves an ordinary text selection to the browser', () => {
    render(
      <InteractionProvider>
        <p data-testid="prose">Just some text on a page.</p>
      </InteractionProvider>,
    );
    const prose = screen.getByTestId('prose');
    selectContentsOf(prose);

    expect(copy(prose).claimed).toBe(false);
  });
});

describe('surfaces that keep their own copy', () => {
  it('leaves a text input alone', () => {
    render(
      <InteractionProvider>
        <div data-object-kind="task" data-object-id="1" data-object-title="Task 1">
          <input data-testid="field" defaultValue="hello" />
        </div>
      </InteractionProvider>,
    );
    const field = screen.getByTestId('field');
    field.focus();

    expect(copy(field).claimed).toBe(false);
  });

  it('leaves the rich-text editor alone, so its own Markdown serializer runs', () => {
    render(
      <InteractionProvider>
        <div data-object-kind="task" data-object-id="1" data-object-title="Task 1">
          <div data-editor-surface="">
            <div data-testid="pm" contentEditable suppressContentEditableWarning>
              Body
            </div>
          </div>
        </div>
      </InteractionProvider>,
    );
    const editor = screen.getByTestId('pm');
    editor.focus();

    expect(copy(editor).claimed).toBe(false);
  });
});
