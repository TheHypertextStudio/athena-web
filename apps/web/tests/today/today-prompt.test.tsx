import '@testing-library/jest-dom/vitest';

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TodayPrompt } from '../../src/components/today/today-prompt';

const openAthena = vi.hoisted(() => vi.fn());
const capturePost = vi.hoisted(() => vi.fn());

vi.mock('../../src/components/athena/athena-panel-provider', () => ({
  useAthenaPanel: () => ({ openAthena }),
}));

vi.mock('../../src/components/mentions/use-mention-org', () => ({
  useMentionOrgId: (orgId: string | null) => orgId ?? undefined,
}));

// The real one renders a Radix popover and a caret mirror against `document.body`; none of that is
// what these cases are about, and the `@` menu's own key interception is covered by its own suite.
vi.mock('../../src/components/mentions/mention-textarea', () => ({
  default: ({
    value,
    onChange,
    ...rest
  }: {
    value: string;
    onChange: (next: string) => void;
  } & React.TextareaHTMLAttributes<HTMLTextAreaElement>) => (
    <textarea
      {...rest}
      value={value}
      onChange={(event) => {
        onChange(event.target.value);
      }}
    />
  ),
}));

vi.mock('../../src/lib/api', () => ({
  api: { v1: { orgs: { ':orgId': { capture: { $post: capturePost } } } } },
}));

const ORG = '01JQ0000000000000000000000';

function typeDraft(text: string): HTMLTextAreaElement {
  const field = screen.getByLabelText('Capture a task or ask Athena');
  fireEvent.change(field, { target: { value: text } });
  return field as HTMLTextAreaElement;
}

beforeEach(() => {
  openAthena.mockReset();
  capturePost.mockReset();
  capturePost.mockResolvedValue({
    ok: true,
    json: async () => ({ id: 'task-1', title: 'Buy milk' }),
  });
  window.localStorage.clear();
});

afterEach(cleanup);

describe('TodayPrompt', () => {
  it('names the destination on the control, so the consequence is never inferred', async () => {
    render(<TodayPrompt orgId={ORG} orgLabel="Space" />);
    typeDraft('Buy milk');

    fireEvent.click(screen.getByRole('button', { name: 'Add task' }));

    await waitFor(() => {
      expect(capturePost).toHaveBeenCalledOnce();
    });
    expect(openAthena).not.toHaveBeenCalled();
  });

  it('routes the same draft to Athena once the mode is switched, and remembers the choice', async () => {
    const first = render(<TodayPrompt orgId={ORG} orgLabel="Space" />);
    fireEvent.click(screen.getByRole('button', { name: /Switch to Athena/ }));
    typeDraft('Plan the launch');

    fireEvent.click(screen.getByRole('button', { name: 'Ask Athena' }));

    expect(openAthena).toHaveBeenCalledOnce();
    expect(capturePost).not.toHaveBeenCalled();

    // The mode is a setting, not a per-submit choice: a fresh mount reads it back.
    first.unmount();
    render(<TodayPrompt orgId={ORG} orgLabel="Space" />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Ask Athena' })).toBeInTheDocument();
    });
  });

  it('sends on Enter, and on Cmd+Enter regardless — the chord the mention menu lets through', async () => {
    render(<TodayPrompt orgId={ORG} orgLabel="Space" />);
    const field = typeDraft('Buy milk');

    fireEvent.keyDown(field, { key: 'Enter' });
    await waitFor(() => {
      expect(capturePost).toHaveBeenCalledOnce();
    });

    typeDraft('Buy bread');
    fireEvent.keyDown(field, { key: 'Enter', metaKey: true });
    await waitFor(() => {
      expect(capturePost).toHaveBeenCalledTimes(2);
    });
  });

  it('leaves Shift+Enter to insert a newline rather than sending', () => {
    render(<TodayPrompt orgId={ORG} orgLabel="Space" />);
    const field = typeDraft('First line');

    fireEvent.keyDown(field, { key: 'Enter', shiftKey: true });

    expect(capturePost).not.toHaveBeenCalled();
    expect(openAthena).not.toHaveBeenCalled();
  });

  it('keeps the send disabled until there is something to send', () => {
    render(<TodayPrompt orgId={ORG} orgLabel="Space" />);
    expect(screen.getByRole('button', { name: 'Add task' })).toBeDisabled();

    typeDraft('   ');
    expect(screen.getByRole('button', { name: 'Add task' })).toBeDisabled();

    typeDraft('Real work');
    expect(screen.getByRole('button', { name: 'Add task' })).toBeEnabled();
  });
});
