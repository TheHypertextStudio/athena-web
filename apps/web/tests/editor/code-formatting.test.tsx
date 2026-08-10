import '@testing-library/jest-dom/vitest';

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FreeformTextEditor } from '@/components/editor/freeform-text';

import { makeQueryWrapper } from '../support/query';
import { installProseMirrorLayoutShims } from './prosemirror-jsdom';

vi.mock('@/components/active-org', () => ({
  useOptionalActiveOrg: () => ({ activeOrgId: null }),
  useActiveOrgIdOptional: () => null,
  useActiveOrg: () => ({ activeOrgId: null }),
}));

installProseMirrorLayoutShims();

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderEditor(value = '', readOnly = false) {
  const onChange = vi.fn();
  const { wrapper: Wrapper } = makeQueryWrapper();
  render(
    <Wrapper>
      <FreeformTextEditor
        value={value}
        onChange={onChange}
        placeholder="Write something"
        ariaLabel="Description"
        readOnly={readOnly}
      />
    </Wrapper>,
  );
  return { onChange, user: userEvent.setup() };
}

describe('Markdown code formatting', () => {
  it('turns exactly three backticks at the start of an empty line into a code block immediately', async () => {
    const { user } = renderEditor();
    const editor = await screen.findByRole('textbox', { name: 'Description' });

    await user.click(editor);
    await user.keyboard('```');

    await waitFor(() => {
      expect(editor.querySelector('pre')).not.toBeNull();
    });
    expect(editor).not.toHaveTextContent('```');
  });

  it('does not turn mid-line backticks into a block', async () => {
    const { user } = renderEditor();
    const editor = await screen.findByRole('textbox', { name: 'Description' });

    await user.click(editor);
    await user.keyboard('Keep ``` literal');

    expect(editor.querySelector('pre')).toBeNull();
  });

  it('toggles inline code with the platform shortcut', async () => {
    const { user } = renderEditor();
    const editor = await screen.findByRole('textbox', { name: 'Description' });

    await user.click(editor);
    await user.keyboard('shortcut');
    await user.keyboard('{Control>}a{/Control}{Control>}e{/Control}');

    await waitFor(() => {
      expect(editor.querySelector('[data-inline-code]')).toHaveTextContent('shortcut');
    });
  });

  it('renders inline code independently from fenced code', async () => {
    renderEditor('Run `pnpm test`.\n\n```typescript\nconst ready = true\n```');
    const editor = await screen.findByRole('textbox', { name: 'Description' });

    expect(editor.querySelector('[data-inline-code]')).toHaveTextContent('pnpm test');
    expect(editor.querySelector('[data-code-block]')).toHaveTextContent('const ready = true');
    await waitFor(() => {
      expect(editor.querySelector('.hljs-keyword')).toHaveTextContent('const');
    });
  });

  it('offers an editable language control and exact copy action', async () => {
    const { user } = renderEditor('```typescript\nconst ready = true\n```');

    const language = await screen.findByRole('combobox', { name: 'Code language' });
    expect(language).toHaveValue('typescript');

    await user.click(screen.getByRole('button', { name: 'Copy code' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Copy code' })).toHaveAttribute(
        'data-copy-state',
        'copied',
      );
    });
    expect(await navigator.clipboard.readText()).toBe('const ready = true');
  });

  it('persists a language change in fenced Markdown', async () => {
    const { onChange, user } = renderEditor('```typescript\nconst ready = true\n```');
    const language = await screen.findByRole('combobox', { name: 'Code language' });

    await user.selectOptions(language, 'python');

    await waitFor(() => {
      expect(String(onChange.mock.calls.at(-1)?.[0] ?? '')).toContain('```python');
    });
  });

  it('uses an outer fence longer than every backtick run in the source', async () => {
    const { onChange, user } = renderEditor('````typescript\nconst fence = "```"\n````');
    const language = await screen.findByRole('combobox', { name: 'Code language' });

    await user.selectOptions(language, 'python');

    const markdown = await waitFor(() => {
      const next = String(onChange.mock.calls.at(-1)?.[0] ?? '');
      expect(next.trimEnd()).toBe('````python\nconst fence = "```"\n````');
      return next.trimEnd();
    });

    cleanup();
    renderEditor(markdown, true);
    expect(await screen.findByText('Python')).toBeVisible();
    expect(document.querySelectorAll('[data-code-block]')).toHaveLength(1);
    expect(document.querySelector('[data-code-block]')).toHaveTextContent('const fence = "```"');
  });

  it('preserves an unknown fence label without trying to highlight it', async () => {
    renderEditor('```cobol\nDISPLAY "READY"\n```', true);

    expect(await screen.findByText('cobol')).toBeVisible();
    expect(screen.getByText('DISPLAY "READY"')).toBeVisible();
    expect(document.querySelector('[class~="hljs-keyword"]')).toBeNull();
  });

  it('offers a stable retry state when clipboard access fails', async () => {
    const { user } = renderEditor('```typescript\nconst ready = true\n```');
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValueOnce(new Error('denied'));

    await user.click(await screen.findByRole('button', { name: 'Copy code' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Copy code' })).toHaveAttribute(
        'data-copy-state',
        'failed',
      );
    });
    expect(screen.getByText('Could not copy code. Try again.')).toBeInTheDocument();
  });

  it('uses a language label instead of an editor control in read-only prose', async () => {
    renderEditor('```typescript\nconst ready = true\n```', true);

    expect(await screen.findByText('TypeScript')).toBeVisible();
    expect(screen.queryByRole('combobox', { name: 'Code language' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Copy code' })).toBeVisible();
  });
});
