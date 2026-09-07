import '@testing-library/jest-dom/vitest';

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { serializeDocumentFigure } from '@docket/markdown-tree';

import { FreeformTextEditor } from '@/components/editor/freeform-text';

import { makeQueryWrapper } from '../support/query';
import { installProseMirrorLayoutShims } from './prosemirror-jsdom';

const imageUpload = vi.hoisted(() => ({
  run: vi.fn<(file: File) => Promise<string | null>>(),
}));

vi.mock('@/components/active-org', () => ({
  useOptionalActiveOrg: () => ({ activeOrgId: 'org_1' }),
  useActiveOrgIdOptional: () => 'org_1',
  useActiveOrg: () => ({ activeOrgId: 'org_1' }),
}));

vi.mock('@/lib/use-document-image-upload', () => ({
  useDocumentImageUpload: () => ({
    upload: imageUpload.run,
    status: 'idle',
    announcement: '',
  }),
}));

installProseMirrorLayoutShims();

beforeEach(() => {
  imageUpload.run.mockReset();
});

afterEach(() => {
  cleanup();
});

function image(name: string, type = 'image/png', contents = 'pixels'): File {
  return new File([contents], name, { type });
}

function renderEditor(value = '') {
  const onChange = vi.fn<(next: string) => void>();
  const { wrapper: Wrapper } = makeQueryWrapper();
  render(
    <Wrapper>
      <FreeformTextEditor
        value={value}
        onChange={onChange}
        placeholder="Write something"
        ariaLabel="Description"
      />
    </Wrapper>,
  );
  return { onChange, user: userEvent.setup() };
}

function privateUrl(file: File): string {
  return `/v1/orgs/org_1/images/${file.name.replaceAll('.', '-')}`;
}

function deferredUpload(): {
  readonly promise: Promise<string | null>;
  readonly resolve: (value: string | null) => void;
} {
  let resolvePromise: (value: string | null) => void = () => undefined;
  const promise = new Promise<string | null>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

describe('semantic figures in the shared prose editor', () => {
  it('opens the same block menu from Insert and uploads multiple browsed files in order', async () => {
    imageUpload.run.mockImplementation(async (file) => privateUrl(file));
    const { onChange, user } = renderEditor();

    await user.click(await screen.findByRole('button', { name: 'Insert' }));
    const menu = await screen.findByRole('listbox', { name: 'Insert a block' });
    await user.click(within(menu).getByRole('option', { name: /Image/ }));
    const first = image('first-diagram.png');
    const second = image('second-photo.jpg', 'image/jpeg');
    fireEvent.change(screen.getByLabelText('Choose images to insert'), {
      target: { files: [first, second] },
    });

    await waitFor(() => {
      expect(screen.getByRole('img', { name: 'First diagram' })).toBeVisible();
      expect(screen.getByRole('img', { name: 'Second photo' })).toBeVisible();
    });
    expect(imageUpload.run.mock.calls.map(([file]) => file.name)).toEqual([
      'first-diagram.png',
      'second-photo.jpg',
    ]);
    await waitFor(() => {
      const markdown = onChange.mock.calls.at(-1)?.[0] ?? '';
      expect(markdown.indexOf('first-diagram-png')).toBeLessThan(
        markdown.indexOf('second-photo-jpg'),
      );
      expect(markdown).toContain('<figure data-docket-figure="1"');
    });
  });

  it('uses the same pending figure pipeline for paste', async () => {
    imageUpload.run.mockImplementation(async (file) => privateUrl(file));
    const { user } = renderEditor();
    const editor = await screen.findByRole('textbox', { name: 'Description' });
    await user.click(editor);

    const pasted = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(pasted, 'clipboardData', {
      value: {
        getData: () => '',
        files: [image('clipboard.png')],
        types: ['Files'],
      },
    });
    editor.dispatchEvent(pasted);

    expect(pasted.defaultPrevented).toBe(true);
    await waitFor(() => {
      expect(screen.getByRole('img', { name: 'Clipboard' })).toBeVisible();
    });
    expect(imageUpload.run).toHaveBeenCalledOnce();
  });

  it('uses the same pending figure pipeline for file drop', async () => {
    imageUpload.run.mockImplementation(async (file) => privateUrl(file));
    const { user } = renderEditor();
    const editor = await screen.findByRole('textbox', { name: 'Description' });
    await user.click(editor);

    fireEvent.drop(editor, {
      clientX: 0,
      clientY: 0,
      dataTransfer: {
        files: [image('dropped.webp', 'image/webp')],
        types: ['Files'],
        getData: () => '',
      },
    });

    expect(await screen.findByRole('img', { name: 'Dropped' })).toBeVisible();
    expect(imageUpload.run).toHaveBeenCalledOnce();
  });

  it('ignores non-file drops and rejects SVG before upload', async () => {
    const { user } = renderEditor();
    const editor = await screen.findByRole('textbox', { name: 'Description' });
    await user.click(editor);

    const nonFile = fireEvent.drop(editor, {
      dataTransfer: { files: [], types: ['text/plain'] },
    });
    fireEvent.drop(editor, {
      dataTransfer: { files: [image('unsafe.svg', 'image/svg+xml')], types: ['Files'] },
    });

    expect(nonFile).toBe(true);
    fireEvent.change(screen.getByLabelText('Choose images to insert'), {
      target: { files: [image('unsafe.svg', 'image/svg+xml')] },
    });
    expect(imageUpload.run).not.toHaveBeenCalled();
    expect(await screen.findByText('Images must be PNG, JPEG, GIF, or WebP.')).toHaveAttribute(
      'aria-live',
      'polite',
    );
  });

  it('keeps a failed upload in place with retry and remove actions', async () => {
    imageUpload.run
      .mockResolvedValueOnce(null)
      .mockImplementation(async (file) => privateUrl(file));
    const { user } = renderEditor();
    fireEvent.change(await screen.findByLabelText('Choose images to insert'), {
      target: { files: [image('retry-me.png')] },
    });

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Could not upload this image.');
    await user.click(within(alert).getByRole('button', { name: 'Retry' }));
    await waitFor(() => {
      expect(screen.queryByRole('alert')).toBeNull();
      expect(screen.getByRole('img', { name: 'Retry me' })).toHaveAttribute(
        'src',
        '/v1/orgs/org_1/images/retry-me-png',
      );
    });

    imageUpload.run.mockResolvedValueOnce(null);
    fireEvent.change(screen.getByLabelText('Choose images to insert'), {
      target: { files: [image('remove-me.png')] },
    });
    const secondAlert = await screen.findByRole('alert');
    await user.click(within(secondAlert).getByRole('button', { name: 'Remove' }));
    expect(screen.queryByRole('img', { name: 'Remove me' })).toBeNull();
  });

  it('preserves the saved source when replacement fails and updates it after retry', async () => {
    const original = serializeDocumentFigure({
      version: 1,
      src: '/v1/orgs/org_1/images/original',
      alt: 'Original plan',
      decorative: false,
    });
    imageUpload.run.mockResolvedValueOnce(null).mockResolvedValueOnce('/v1/orgs/org_1/images/new');
    const { onChange, user } = renderEditor(original);
    await user.click(await screen.findByRole('img', { name: 'Original plan' }));
    await user.click(await screen.findByRole('button', { name: 'Replace' }));
    fireEvent.change(screen.getByLabelText('Replace image file'), {
      target: { files: [image('new-plan.png')] },
    });

    const alert = await screen.findByRole('alert');
    expect(onChange.mock.calls.at(-1)?.[0]).toContain('/images/original');
    await user.click(within(alert).getByRole('button', { name: 'Retry' }));
    await waitFor(() => {
      expect(onChange.mock.calls.at(-1)?.[0]).toContain('/images/new');
    });
  });

  it('lets undo remove an unresolved pending figure without reinserting it later', async () => {
    const pending = deferredUpload();
    imageUpload.run.mockReturnValue(pending.promise);
    const { user } = renderEditor();
    const editor = await screen.findByRole('textbox', { name: 'Description' });
    await user.click(editor);
    fireEvent.change(screen.getByLabelText('Choose images to insert'), {
      target: { files: [image('undo.png')] },
    });
    expect(await screen.findByRole('status')).toHaveTextContent('Uploading image');

    await user.keyboard('{Control>}z{/Control}');
    await waitFor(() => {
      expect(screen.queryByRole('img', { name: 'Undo' })).toBeNull();
    });
    pending.resolve('/v1/orgs/org_1/images/late');
    await Promise.resolve();
    expect(screen.queryByRole('img', { name: 'Undo' })).toBeNull();
  });

  it('edits the caption, alternative text, and attribution as semantic figure data', async () => {
    const original = serializeDocumentFigure({
      version: 1,
      src: '/v1/orgs/org_1/images/map',
      alt: 'Draft map',
      decorative: false,
    });
    const { onChange, user } = renderEditor(original);
    const figure = (await screen.findByRole('img', { name: 'Draft map' })).closest('figure');
    if (!figure) throw new Error('Expected the semantic figure.');
    const caption = within(figure).getByRole('textbox', { name: 'Image caption' });
    fireEvent.change(caption, { target: { value: 'Stops proposed for 2027' } });
    expect(caption).toHaveValue('Stops proposed for 2027');
    await waitFor(() => {
      expect(onChange.mock.calls.at(-1)?.[0]).toContain('Stops proposed for 2027');
    });
    await user.click(screen.getByRole('img', { name: 'Draft map' }));
    await user.click(await screen.findByRole('button', { name: 'Details' }));
    await user.clear(screen.getByLabelText('Alt text'));
    await user.type(screen.getByLabelText('Alt text'), 'Map of proposed stops');
    await user.type(screen.getByLabelText('Credit'), 'RTC planning staff');
    await user.type(screen.getByLabelText('Source URL'), 'https://example.com/source');
    await user.type(screen.getByLabelText('License'), 'CC BY 4.0');
    await user.type(
      screen.getByLabelText('License URL'),
      'https://creativecommons.org/licenses/by/4.0/',
    );
    await user.click(screen.getByRole('button', { name: 'Save details' }));

    await waitFor(() => {
      const markdown = onChange.mock.calls.at(-1)?.[0] ?? '';
      expect(markdown).toContain('Stops proposed for 2027');
      expect(markdown).toContain('alt="Map of proposed stops"');
      expect(markdown).toContain('itemprop="creditText">RTC planning staff');
      expect(markdown).toContain('rel="license"');
    });
    expect(screen.getByRole('link', { name: 'Source' })).toHaveAttribute(
      'href',
      'https://example.com/source',
    );
  });

  it('stores decorative figures with an empty alternative', async () => {
    const original = serializeDocumentFigure({
      version: 1,
      src: '/v1/orgs/org_1/images/divider',
      alt: 'Blue divider',
      decorative: false,
    });
    const { onChange, user } = renderEditor(original);
    await user.click(await screen.findByRole('img', { name: 'Blue divider' }));
    await user.click(await screen.findByRole('button', { name: 'Details' }));
    await user.click(screen.getByLabelText('This image is decorative'));

    expect(screen.getByLabelText('Alt text')).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Save details' }));

    await waitFor(() => {
      const markdown = onChange.mock.calls.at(-1)?.[0] ?? '';
      expect(markdown).toContain('data-decorative="true"');
      expect(markdown).toContain('alt=""');
    });
    expect(screen.getByRole('presentation')).toHaveAttribute('alt', '');
  });

  it('renders saved captions as text and hides empty caption controls from readers', async () => {
    const uncaptured = serializeDocumentFigure({
      version: 1,
      src: '/v1/orgs/org_1/images/uncaptioned',
      alt: 'Transit center platform',
      decorative: false,
    });
    const captioned = serializeDocumentFigure({
      version: 1,
      src: '/v1/orgs/org_1/images/captioned',
      alt: 'Station entrance',
      decorative: false,
      caption: 'The north entrance after construction.',
      creditText: 'Docket planning team',
    });
    const { wrapper: Wrapper } = makeQueryWrapper();
    const { container } = render(
      <Wrapper>
        <FreeformTextEditor
          value={`${uncaptured}\n\n${captioned}`}
          onChange={() => undefined}
          placeholder=""
          ariaLabel="Description"
          readOnly
        />
      </Wrapper>,
    );

    expect(await screen.findByText('The north entrance after construction.')).toHaveAttribute(
      'itemprop',
      'caption',
    );
    expect(screen.queryByRole('textbox', { name: 'Image caption' })).toBeNull();
    expect(screen.queryByPlaceholderText('Add a caption')).toBeNull();
    expect(screen.getByText('Docket planning team')).toHaveAttribute('itemprop', 'creditText');
    expect(container.querySelectorAll('figcaption')).toHaveLength(1);
    for (const figure of container.querySelectorAll('figure')) {
      expect(figure).toHaveAttribute('tabindex', '-1');
    }
  });

  it('focuses the non-wrapping toolbar with Alt+F10 and returns focus on Escape', async () => {
    const original = serializeDocumentFigure({
      version: 1,
      src: '/v1/orgs/org_1/images/photo',
      alt: 'Transit center',
      decorative: false,
    });
    const { user } = renderEditor(original);
    const editor = await screen.findByRole('textbox', { name: 'Description' });
    const imageNode = await screen.findByRole('img', { name: 'Transit center' });
    await user.click(imageNode);
    const toolbar = await screen.findByRole('toolbar', { name: 'Image controls' });
    expect(toolbar).toHaveClass('flex-nowrap', 'whitespace-nowrap');

    editor.focus();
    fireEvent.keyDown(editor, { altKey: true, key: 'F10' });
    expect(screen.getByRole('button', { name: 'Replace' })).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(imageNode.closest('figure')).toHaveFocus();
  });
});
