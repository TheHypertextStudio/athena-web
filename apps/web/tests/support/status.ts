import { screen } from '@testing-library/react';

/**
 * The text of every polite live region on screen.
 *
 * A composer carries more than one: the shell's announcement of a completed create, and the draft
 * chip's save state. A test that checks one message reads them all and looks for it.
 */
export function statusMessages(): (string | null)[] {
  return screen.getAllByRole('status').map((element) => element.textContent);
}
