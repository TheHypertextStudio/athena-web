/**
 * Behavior tests for the validation line under {@link SettingsImagePicker}.
 *
 * @remarks
 * A file the picker will not accept is a value problem in one control, so it is a `FieldError`
 * wired to that control, not a notice: the input names the error through `aria-describedby` and is
 * marked `aria-invalid` until a valid file replaces it.
 */
import '@testing-library/jest-dom/vitest';

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SettingsImagePicker } from '../../../src/components/settings/settings-image-picker';

afterEach(cleanup);

/** Render the picker and return its change handler spy and the hidden file input. */
function renderPicker(): {
  readonly onChange: ReturnType<typeof vi.fn>;
  readonly input: HTMLElement;
} {
  const onChange = vi.fn();
  render(<SettingsImagePicker label="Workspace logo" value="" fallback="W" onChange={onChange} />);
  return { onChange, input: screen.getByLabelText('Choose workspace logo') };
}

describe('SettingsImagePicker validation', () => {
  it('names a rejected file through the input and does not pass it on', async () => {
    const { onChange, input } = renderPicker();
    // `applyAccept: false` so the browser-level `accept` filter does not hide the rejection this
    // test is about; the picker's own check is the boundary under test.
    const user = userEvent.setup({ applyAccept: false });

    await user.upload(input, new File(['not an image'], 'notes.txt', { type: 'text/plain' }));

    const alert = await screen.findByRole('alert');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAttribute('aria-describedby', alert.id);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('clears the rejection once a valid image is chosen', async () => {
    const { onChange, input } = renderPicker();
    const user = userEvent.setup({ applyAccept: false });

    await user.upload(input, new File(['not an image'], 'notes.txt', { type: 'text/plain' }));
    await screen.findByRole('alert');
    await user.upload(input, new File(['png bytes'], 'logo.png', { type: 'image/png' }));

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledTimes(1);
    });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(input).not.toHaveAttribute('aria-invalid');
    expect(input).not.toHaveAttribute('aria-describedby');
  });
});
