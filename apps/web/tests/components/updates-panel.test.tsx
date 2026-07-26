/**
 * Behavior tests for the shared entity updates composer.
 *
 * @remarks
 * The panel used to clear its textarea the moment the form was submitted, before the parent's write
 * had settled. A failed post therefore rendered its error message over an empty box, having already
 * discarded the text the author needed in order to retry — the update was simply gone. These tests
 * pin the corrected lifetime: the draft survives a failure and clears only once the post succeeds.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  UpdatesPanel,
  type UpdatesPanelProps,
} from '../../src/components/entity-detail/updates-panel';

afterEach(() => {
  cleanup();
});

/** Render the panel with an empty history and the supplied post handler. */
function renderPanel(onPost: UpdatesPanelProps['onPost']): void {
  render(
    <UpdatesPanel
      updates={[]}
      loading={false}
      error={null}
      resolveActor={() => ({ name: 'Grace Hopper', kind: 'human' })}
      posting={false}
      postError={null}
      onPost={onPost}
      showHealthComposer={false}
    />,
  );
}

/** The update composer's textarea. */
function draftField(): HTMLTextAreaElement {
  return screen.getByLabelText('Post an update');
}

/** Submit the composer the way pressing its post button does. */
function submitDraft(): void {
  const form = draftField().closest('form');
  if (!form) throw new Error('the update composer is not inside a form');
  fireEvent.submit(form);
}

describe('UpdatesPanel composer', () => {
  it('clears the draft once the post succeeds', async () => {
    const onPost = vi.fn().mockResolvedValue(undefined);
    renderPanel(onPost);

    fireEvent.change(draftField(), { target: { value: 'Shipped the ingest rewrite.' } });
    submitDraft();

    await waitFor(() => {
      expect(draftField().value).toBe('');
    });
    expect(onPost).toHaveBeenCalledWith('Shipped the ingest rewrite.', undefined);
  });

  it('keeps the draft when the post fails, so it can be retried', async () => {
    const onPost = vi.fn().mockRejectedValue(new Error('offline'));
    renderPanel(onPost);

    fireEvent.change(draftField(), { target: { value: 'Risk: the vendor migration slipped.' } });
    submitDraft();

    await waitFor(() => {
      expect(onPost).toHaveBeenCalledTimes(1);
    });
    expect(draftField().value).toBe('Risk: the vendor migration slipped.');
  });
});
