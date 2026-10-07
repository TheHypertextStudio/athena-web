import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { ActivityPanels } from '../../../src/components/shell/ActivityPanels';

afterEach(cleanup);

it('retains an edited panel when hidden and shown again', () => {
  const primary = <input aria-label="Task title" defaultValue="Launch update" />;
  const secondary = <p>Agenda</p>;
  const view = render(
    <ActivityPanels primary={primary} secondary={secondary} showPrimary showSecondary />,
  );
  const title = screen.getByRole('textbox');
  fireEvent.change(title, { target: { value: 'Release notes' } });
  view.rerender(
    <ActivityPanels primary={primary} secondary={secondary} showPrimary={false} showSecondary />,
  );
  expect(title).not.toBeVisible();
  view.rerender(
    <ActivityPanels primary={primary} secondary={secondary} showPrimary showSecondary={false} />,
  );
  expect(screen.getByRole('textbox')).toBe(title);
  expect(title).toHaveValue('Release notes');
  expect(screen.getByText('Agenda')).not.toBeVisible();
});
