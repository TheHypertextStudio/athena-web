import { fireEvent, screen, within } from '@testing-library/react';

/** Choose a picker option by its label text, clicking the option's inner button. */
export function choosePickerOption(label: RegExp | string): void {
  const option = screen.getByRole('option', { name: label });
  fireEvent.click(within(option).getByRole('button'));
}
