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
    orgId: _orgId,
    insertMode: _insertMode,
    autoGrow: _autoGrow,
    maxRows: _maxRows,
    ...rest
  }: {
    value: string;
    onChange: (next: string) => void;
    orgId?: string;
    insertMode?: string;
    autoGrow?: boolean;
    maxRows?: number;
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
  const field = screen.getByLabelText('Ask Athena about today');
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
  it('shows both destinations at once, with Athena the armed one', () => {
    render(<TodayPrompt orgId={ORG} orgLabel="Space" />);
    expect(screen.getByLabelText('Ask Athena about today')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ask Athena' })).toBeDisabled();

    // The chevron this replaces kept the armed destination off-screen, so the same Enter key
    // inserted a row or started an agent depending on state you had to infer.
    expect(screen.getByRole('button', { name: 'Athena' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Task' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('routes the default draft to Athena and resets an explicit task-capture switch on revisit', async () => {
    const first = render(<TodayPrompt orgId={ORG} orgLabel="Space" />);
    typeDraft('Plan the launch');

    fireEvent.click(screen.getByRole('button', { name: 'Ask Athena' }));

    expect(openAthena).toHaveBeenCalledOnce();
    expect(capturePost).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Task' }));
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
      expect(openAthena).toHaveBeenCalledOnce();
    });

    typeDraft('Buy bread');
    fireEvent.keyDown(field, { key: 'Enter', metaKey: true });
    await waitFor(() => {
      expect(openAthena).toHaveBeenCalledTimes(2);
    });
  });

  it('asks its host to expand into the session instead of sliding the dock over the page', () => {
    const onStartSession = vi.fn();
    render(<TodayPrompt orgId={ORG} orgLabel="Space" onStartSession={onStartSession} />);
    typeDraft('Plan the launch');

    fireEvent.click(screen.getByRole('button', { name: 'Ask Athena' }));

    // Exactly one surface. Firing both put the dock on top of the page that had just become the
    // same conversation — two Athena surfaces at once, which is the thing the model forbids.
    expect(onStartSession).toHaveBeenCalledWith('Plan the launch');
    expect(openAthena).not.toHaveBeenCalled();
  });

  it('still opens the dock when the host hosts no session of its own', () => {
    render(<TodayPrompt orgId={ORG} orgLabel="Space" />);
    typeDraft('Plan the launch');

    fireEvent.click(screen.getByRole('button', { name: 'Ask Athena' }));

    expect(openAthena).toHaveBeenCalledOnce();
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
    expect(screen.getByRole('button', { name: 'Ask Athena' })).toBeDisabled();

    typeDraft('   ');
    expect(screen.getByRole('button', { name: 'Ask Athena' })).toBeDisabled();

    typeDraft('Real work');
    expect(screen.getByRole('button', { name: 'Ask Athena' })).toBeEnabled();
  });
});
