import '@testing-library/jest-dom/vitest';

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { MenuListbox, MenuOption } from '../../../src/components/menus/MenuListbox';

describe('MenuListbox', () => {
  it('activates an option on pointer down without stealing focus from its input owner', () => {
    const onSelect = vi.fn();
    render(
      <>
        <input aria-label="Find" />
        <MenuListbox ariaLabel="Results">
          <MenuOption onSelect={onSelect}>Ada Lovelace</MenuOption>
        </MenuListbox>
      </>,
    );

    const input = screen.getByRole('textbox', { name: 'Find' });
    input.focus();
    fireEvent.pointerDown(screen.getByRole('option', { name: 'Ada Lovelace' }));

    expect(onSelect).toHaveBeenCalledOnce();
    expect(input).toHaveFocus();
  });

  it('activates an option selected by a synthetic click once', () => {
    const onSelect = vi.fn();
    render(
      <MenuListbox ariaLabel="Results">
        <MenuOption onSelect={onSelect}>Ada Lovelace</MenuOption>
      </MenuListbox>,
    );

    fireEvent.click(screen.getByRole('option', { name: 'Ada Lovelace' }));
    expect(onSelect).toHaveBeenCalledOnce();
  });

  it('keeps secondary detail in the option accessible name', () => {
    render(
      <MenuListbox ariaLabel="Results">
        <MenuOption secondary="Project Athena">Ada Lovelace</MenuOption>
      </MenuListbox>,
    );

    expect(screen.getByRole('option', { name: /Ada Lovelace\s*Project Athena/ })).toBeVisible();
  });
});
