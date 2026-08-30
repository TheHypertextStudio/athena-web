import '@testing-library/jest-dom/vitest';

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import {
  MenuDivider,
  MenuListbox,
  MenuOption,
  MenuSectionLabel,
} from '../../../src/components/menus/MenuListbox';

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
    fireEvent.click(screen.getByRole('option', { name: 'Ada Lovelace' }));

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

  it('activates an option on mouse down without moving focus', () => {
    const onSelect = vi.fn();
    render(
      <MenuListbox ariaLabel="Results">
        <MenuOption onSelect={onSelect}>Ada Lovelace</MenuOption>
      </MenuListbox>,
    );

    fireEvent.mouseDown(screen.getByRole('option', { name: 'Ada Lovelace' }));
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

  it('renders every option slot and previews the active row on hover', () => {
    const onActiveChange = vi.fn();
    const onMouseEnter = vi.fn();
    render(
      <MenuListbox ariaLabel="Results" className="menu-results">
        <MenuOption
          active
          selected={false}
          leading={<span>Lead</span>}
          supporting="Supporting"
          badge={<span>Badge</span>}
          trailing={<span>Trailing</span>}
          onActiveChange={onActiveChange}
          onMouseEnter={onMouseEnter}
        >
          Ada Lovelace
        </MenuOption>
      </MenuListbox>,
    );

    const listbox = screen.getByRole('listbox', { name: 'Results' });
    const option = screen.getByRole('option', { name: /Ada Lovelace/ });
    expect(listbox).toHaveClass('contents', 'menu-results');
    expect(option).toHaveAttribute('data-active', 'true');
    expect(option).toHaveAttribute('aria-selected', 'false');
    expect(option).toHaveTextContent('LeadAda LovelaceSupportingBadgeTrailing');

    fireEvent.mouseEnter(option);
    expect(onMouseEnter).toHaveBeenCalledOnce();
    expect(onActiveChange).toHaveBeenCalledOnce();
  });

  it('honors a caller that cancels pointer selection', () => {
    const onSelect = vi.fn();
    render(
      <MenuListbox ariaLabel="Results">
        <MenuOption
          onPointerDown={(event) => {
            event.preventDefault();
          }}
          onSelect={onSelect}
        >
          Ada Lovelace
        </MenuOption>
      </MenuListbox>,
    );

    fireEvent.pointerDown(screen.getByRole('option', { name: 'Ada Lovelace' }));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('renders section labels and dividers in list and grouped-container forms', () => {
    render(
      <MenuListbox ariaLabel="Results">
        <MenuSectionLabel>People</MenuSectionLabel>
        <MenuDivider />
        <li role="group">
          <MenuSectionLabel as="p">Files</MenuSectionLabel>
          <MenuDivider as="div" data-testid="group-divider" />
        </li>
      </MenuListbox>,
    );

    expect(screen.getByText('People')).toHaveAttribute('role', 'presentation');
    expect(screen.getByRole('separator')).toBeVisible();
    expect(screen.getByText('Files').tagName).toBe('P');
    expect(screen.getByTestId('group-divider').tagName).toBe('DIV');
  });
});
