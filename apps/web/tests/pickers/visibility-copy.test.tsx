import '@testing-library/jest-dom/vitest';

import { EnumPicker } from '@docket/ui/components';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { VISIBILITY_OPTIONS } from '@/components/pickers/options';

/**
 * The public/private control explains itself at the point of use.
 *
 * @remarks
 * The launch note is "It's unclear what public/private is really doing." Two bare words in a menu
 * are exactly that: they name a consequence without stating it. These tests hold the control to
 * saying, in the menu where the choice is actually made, who can reach the object under each
 * setting — and hold the copy to what the system *does*, not to a stronger promise it does not
 * keep (visibility is applied in workspace search; the list and detail routes do not yet apply
 * the same predicate, so the copy deliberately says "find it in search").
 */
afterEach(cleanup);

describe('the visibility control explains itself', () => {
  it('states who can reach the object under each setting, in the menu', async () => {
    const user = userEvent.setup();
    render(
      <EnumPicker
        options={VISIBILITY_OPTIONS}
        value="public"
        onChange={vi.fn()}
        placeholder="Set visibility"
        ariaLabel="Visibility"
      />,
    );
    await user.click(screen.getByRole('button', { name: /Visibility/ }));
    const list = await screen.findByRole('listbox');

    const options = within(list).getAllByRole('option');
    expect(options).toHaveLength(2);
    expect(options[0]).toHaveTextContent('Public');
    expect(options[0]).toHaveTextContent('Anyone in this workspace can find it in search.');
    expect(options[1]).toHaveTextContent('Private');
    expect(options[1]).toHaveTextContent('Kept out of search for anyone without access to it.');
  });

  it('names an audience in every description — never a bare label', () => {
    for (const option of VISIBILITY_OPTIONS) {
      expect(option.supporting, option.value).toMatch(/anyone|everyone|people|workspace/i);
      expect(option.supporting?.length, option.value).toBeGreaterThan(20);
    }
  });

  it('carries a glyph on each choice so the two are distinguishable at a glance', () => {
    for (const option of VISIBILITY_OPTIONS) {
      expect(option.icon).toBeTruthy();
      expect(option.supporting).toBeTruthy();
    }
  });
});
