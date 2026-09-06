import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as emojiCatalogModule from '@docket/ui/icons/emoji-catalog';

import { EntityIconPicker } from '../../src/components/entity-display/entity-icon-picker';

const baseDisplay = {
  subjectType: 'initiative' as const,
  subjectId: 'initiative-1',
  glyph: { kind: 'symbol' as const, name: 'track_changes' },
  iconKey: 'target' as const,
  colorKey: 'neutral' as const,
  customColor: null,
  coverImage: null,
  customized: false,
};

beforeEach(() => {
  localStorage.clear();
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  vi.stubGlobal(
    'ResizeObserver',
    class ResizeObserverMock {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    },
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function renderPicker(onChange = vi.fn()): Promise<ReturnType<typeof vi.fn>> {
  render(
    <EntityIconPicker
      display={baseDisplay}
      workspaceId="workspace-1"
      entityName="Transit coalition"
      editable
      pending={false}
      onChange={onChange}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Customize Transit coalition icon' }));
  await screen.findByRole('searchbox', { name: 'Search icons' }, { timeout: 15_000 });
  return onChange;
}

describe('EntityIconPicker', () => {
  it('autofocuses the selected catalog search and exposes separate browse tabs', async () => {
    await renderPicker();

    expect(screen.getByRole('searchbox', { name: 'Search icons' })).toHaveFocus();
    expect(screen.getByRole('tab', { name: 'Icons' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Emoji' })).toHaveAttribute('aria-selected', 'false');
    expect(screen.getAllByTestId('entity-glyph-option').length).toBeGreaterThan(20);
  });

  it('uses hierarchy without horizontal hairlines', async () => {
    await renderPicker();

    expect(screen.getByTestId('entity-glyph-search-header')).not.toHaveClass('border-b');
    expect(screen.getByRole('tablist', { name: 'Glyph catalog' })).not.toHaveClass('border-b');
    expect(screen.getByRole('tab', { name: 'Icons' }).className).not.toContain('after:h-0.5');
    expect(screen.getByTestId('entity-glyph-color-footer')).not.toHaveClass('border-t');
  });

  it('implements the tab keyboard pattern and links the selected tab to its panel', async () => {
    await renderPicker();
    const icons = screen.getByRole('tab', { name: 'Icons' });
    const emoji = screen.getByRole('tab', { name: 'Emoji' });

    expect(icons).toHaveAttribute('tabindex', '0');
    expect(emoji).toHaveAttribute('tabindex', '-1');
    expect(icons).toHaveAttribute('aria-controls');
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', icons.id);

    icons.focus();
    fireEvent.keyDown(icons, { key: 'ArrowRight' });

    expect(emoji).toHaveFocus();
    expect(emoji).toHaveAttribute('aria-selected', 'true');
  });

  it('searches only the selected catalog and preserves the query when switching tabs', async () => {
    const loadEmoji = vi.spyOn(emojiCatalogModule, 'loadEntityEmojiCatalog');
    await renderPicker();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search icons' }), {
      target: { value: 'rocket' },
    });

    expect(await screen.findByTestId('icon-search-results')).toBeInTheDocument();
    expect(screen.queryByTestId('emoji-search-results')).toBeNull();
    expect(
      within(screen.getByTestId('icon-search-results')).getAllByRole('button').length,
    ).toBeGreaterThan(0);
    expect(
      screen.getByTestId('icon-search-results').querySelector('[data-virtualized-glyph-grid]'),
    ).toHaveStyle({ height: '42px' });
    expect(loadEmoji).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('tab', { name: 'Emoji' }));

    expect(screen.getByRole('searchbox', { name: 'Search emoji' })).toHaveValue('rocket');
    expect(screen.queryByTestId('icon-search-results')).toBeNull();
    expect(await screen.findByTestId('emoji-search-results')).toBeInTheDocument();
    expect(
      within(screen.getByTestId('emoji-search-results')).getAllByRole('button').length,
    ).toBeGreaterThan(0);
    expect(
      screen.getByTestId('emoji-search-results').querySelector('[data-virtualized-glyph-grid]'),
    ).toHaveStyle({ height: '42px' });
    expect(loadEmoji).toHaveBeenCalledTimes(1);
  });

  it('shows an owned empty result for the selected catalog', async () => {
    await renderPicker();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search icons' }), {
      target: { value: 'no-such-glyph-7f4a2' },
    });

    expect(await screen.findByText('No matching icons')).toBeInTheDocument();
  });

  it('shows name-based suggestions before the complete icon catalog', async () => {
    await renderPicker();
    const suggestions = screen.getByRole('group', { name: 'Suggested' });
    expect(within(suggestions).getByRole('button', { name: 'Directions bus' })).toBeInTheDocument();
  });

  it('previews every candidate as the selected tinted entity identity', async () => {
    await renderPicker();
    const first = within(screen.getByRole('group', { name: 'Suggested' })).getAllByTestId(
      'entity-glyph-option',
    )[0];
    if (!first) throw new Error('Expected a suggested glyph.');

    expect(within(first).getByTestId('initiative-icon-circle')).toHaveAttribute(
      'data-glyph-kind',
      'symbol',
    );
  });

  it('keeps one option per glyph grid in the Tab order', async () => {
    await renderPicker();
    const options = within(screen.getByRole('group', { name: 'All icons' })).getAllByTestId(
      'entity-glyph-option',
    );

    expect(options.filter((option) => option.tabIndex === 0)).toHaveLength(1);
    expect(options.filter((option) => option.tabIndex === -1).length).toBeGreaterThan(1);
  });

  it('moves from search into the first result with ArrowDown', async () => {
    await renderPicker();
    const search = screen.getByRole('searchbox', { name: 'Search icons' });
    fireEvent.change(search, { target: { value: 'rocket' } });
    await screen.findByRole('group', { name: 'Icon search results' });

    fireEvent.keyDown(search, { key: 'ArrowDown' });

    expect(
      within(screen.getByRole('group', { name: 'Icon search results' })).getAllByTestId(
        'entity-glyph-option',
      )[0],
    ).toHaveFocus();
  });

  it('announces changed search-result counts', async () => {
    await renderPicker();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search icons' }), {
      target: { value: 'rocket' },
    });

    const iconStatus = await screen.findByRole('status');
    expect(iconStatus).toHaveTextContent(/icons/i);
    expect(iconStatus).not.toHaveTextContent(/emoji/i);

    fireEvent.click(screen.getByRole('tab', { name: 'Emoji' }));

    const emojiStatus = await screen.findByRole('status');
    expect(emojiStatus).toHaveTextContent(/emoji/i);
    expect(emojiStatus).not.toHaveTextContent(/icons/i);
  });

  it('moves through the grid with arrows and selects with Enter', async () => {
    const onChange = await renderPicker();
    const catalog = screen.getByRole('group', { name: 'All icons' });
    const options = within(catalog).getAllByTestId('entity-glyph-option');
    const first = options[0];
    const second = options[1];
    if (!first || !second) throw new Error('Expected at least two mounted icon choices.');
    first.focus();
    fireEvent.keyDown(first, { key: 'ArrowRight' });
    expect(second).toHaveFocus();
    fireEvent.keyDown(second, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'symbol' }),
      'neutral',
      null,
    );
    fireEvent.keyDown(first, { key: ' ' });
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it('supports Home, End, PageUp, and PageDown inside suggestion grids', async () => {
    await renderPicker();
    const suggestions = screen.getByRole('group', { name: 'Suggested' });
    const options = within(suggestions).getAllByTestId('entity-glyph-option');
    const first = options[0];
    const last = options.at(-1);
    if (!first || !last) throw new Error('Expected mounted name-based suggestions.');

    first.focus();
    fireEvent.keyDown(first, { key: 'End' });
    expect(last).toHaveFocus();
    fireEvent.keyDown(last, { key: 'PageUp' });
    expect(first).toHaveFocus();
    fireEvent.keyDown(first, { key: 'PageDown' });
    expect(last).toHaveFocus();
    fireEvent.keyDown(last, { key: 'Home' });
    expect(first).toHaveFocus();
  });

  it('moves to unmounted rows inside the virtualized catalog', async () => {
    await renderPicker();
    const catalog = screen.getByRole('group', { name: 'All icons' });
    const first = within(catalog).getAllByTestId('entity-glyph-option')[0];
    if (!first) throw new Error('Expected a mounted icon choice.');

    first.focus();
    fireEvent.keyDown(first, { key: 'End' });

    await waitFor(() => {
      expect(catalog.querySelector(`[data-option-index="${String(3904)}"]`)).toHaveFocus();
    });
  });

  it('closes on Escape and returns focus to its trigger', async () => {
    await renderPicker();
    const trigger = screen.getByRole('button', { name: 'Customize Transit coalition icon' });
    const option = within(screen.getByRole('group', { name: 'Suggested' })).getAllByTestId(
      'entity-glyph-option',
    )[0];
    if (!option) throw new Error('Expected a suggested glyph.');
    option.focus();
    fireEvent.keyDown(option, { key: 'Escape' });

    await waitFor(() => {
      expect(screen.queryByRole('searchbox', { name: /Search (icons|emoji)/ })).toBeNull();
      expect(trigger).toHaveFocus();
    });
  });

  it('stores emoji recents and the selected fully qualified skin tone by workspace', async () => {
    const onChange = await renderPicker();
    fireEvent.click(screen.getByRole('tab', { name: 'Emoji' }));
    await screen.findByRole('radio', { name: 'Medium skin tone' });
    const mediumTone = screen.getByRole('radio', { name: 'Medium skin tone' });
    expect(mediumTone).toHaveTextContent('✋🏽');
    fireEvent.click(mediumTone);
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search emoji' }), {
      target: { value: 'thumbs up' },
    });
    fireEvent.click(await screen.findByRole('button', { name: 'thumbs up: medium skin tone' }));

    expect(onChange).toHaveBeenCalledWith(
      { kind: 'emoji', hexcode: '1F44D-1F3FD' },
      'neutral',
      null,
    );
    expect(localStorage.getItem('docket.entity-glyph.skin-tone.workspace-1')).toBe('1F3FD');
    expect(localStorage.getItem('docket.entity-glyph.recents.workspace-1')).toContain(
      '1F44D-1F3FD',
    );
  });

  it('exposes skin tones as one roving radio group', async () => {
    await renderPicker();
    fireEvent.click(screen.getByRole('tab', { name: 'Emoji' }));
    const tones = await screen.findByRole('radiogroup', { name: 'Skin tone' });
    const radios = within(tones).getAllByRole('radio');

    expect(radios.filter((radio) => radio.tabIndex === 0)).toHaveLength(1);
    expect(within(tones).getByRole('radio', { name: 'Default skin tone' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  it('offers a retry when the emoji catalog fails to load', async () => {
    const load = vi
      .spyOn(emojiCatalogModule, 'loadEntityEmojiCatalog')
      .mockRejectedValueOnce(new Error('catalog unavailable'))
      .mockResolvedValueOnce({
        emoji: [{ hexcode: '1F680', label: 'rocket', unicode: '🚀' }],
        groups: [],
        skinTones: [],
        shortcodes: { '1F680': ['rocket'] },
      });
    await renderPicker();
    fireEvent.click(screen.getByRole('tab', { name: 'Emoji' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Emoji could not load');
    fireEvent.click(screen.getByRole('button', { name: 'Retry emoji' }));

    await screen.findByRole('group', { name: 'All emoji' });
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('deduplicates workspace recents and caps them at twenty-four choices', async () => {
    const names = [
      'rocket_launch',
      'track_changes',
      'outlined_flag',
      'layers',
      'folder_open',
      'account_tree',
      'public',
      'groups',
      'auto_awesome',
      'directions_bus',
      'train',
      'subway',
      'route',
      'map',
      'campaign',
      'school',
      'menu_book',
      'event',
      'handshake',
      'account_balance',
      'how_to_vote',
      'diversity_3',
      'hub',
      'psychology',
      'lightbulb',
    ];
    localStorage.setItem(
      'docket.entity-glyph.recents.workspace-1',
      JSON.stringify(names.map((name) => ({ kind: 'symbol', name }))),
    );
    await renderPicker();
    await screen.findByRole('group', { name: 'Recent' });
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search icons' }), {
      target: { value: 'rocket launch' },
    });
    fireEvent.click(
      within(screen.getByTestId('icon-search-results')).getByRole('button', {
        name: 'Rocket launch',
      }),
    );

    const stored = JSON.parse(
      localStorage.getItem('docket.entity-glyph.recents.workspace-1') ?? '[]',
    ) as { kind: string; name: string }[];
    expect(stored).toHaveLength(24);
    expect(stored[0]).toEqual({ kind: 'symbol', name: 'rocket_launch' });
    expect(stored.filter((glyph) => glyph.name === 'rocket_launch')).toHaveLength(1);
  });

  it('previews a custom color during input and saves once on commit', async () => {
    const onChange = await renderPicker();
    fireEvent.click(screen.getByRole('button', { name: 'Choose color, Neutral' }));
    const custom = screen.getByLabelText('Custom color value');
    fireEvent.input(custom, { target: { value: '#ff0000' } });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.blur(custom);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(baseDisplay.glyph, 'neutral', '#ff0000');
  });

  it('saves a preset color once and disables choices while the display is loading', async () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <EntityIconPicker
        display={baseDisplay}
        workspaceId="workspace-1"
        entityName="Transit coalition"
        editable
        pending={false}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Customize Transit coalition icon' }));
    await screen.findByRole('searchbox', { name: 'Search icons' });
    fireEvent.click(screen.getByRole('button', { name: 'Choose color, Neutral' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Purple' }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(baseDisplay.glyph, 'purple', null);

    rerender(
      <EntityIconPicker
        display={baseDisplay}
        workspaceId="workspace-1"
        entityName="Transit coalition"
        editable
        pending={false}
        loading
        onChange={onChange}
      />,
    );
    expect(screen.getAllByTestId('entity-glyph-option')[0]).toBeDisabled();
    expect(screen.getByRole('radio', { name: 'Purple' })).toBeDisabled();
  });

  it('exposes colors as fixed-size radio targets with one roving Tab stop', async () => {
    await renderPicker();
    fireEvent.click(screen.getByRole('button', { name: 'Choose color, Neutral' }));
    const colors = screen.getByRole('radiogroup', { name: 'Entity color' });
    const radios = within(colors).getAllByRole('radio');

    expect(radios).toHaveLength(15);
    expect(radios.filter((radio) => radio.tabIndex === 0)).toHaveLength(1);
    for (const radio of radios) {
      expect(radio).toHaveClass('size-10', 'shrink-0');
    }
  });

  it('renders a non-interactive emoji for a read-only cross-workspace reference', () => {
    render(
      <EntityIconPicker
        display={{ ...baseDisplay, glyph: { kind: 'emoji', hexcode: '1F680' } }}
        workspaceId="workspace-1"
        entityName="Regional coalition"
        editable={false}
        pending={false}
        onChange={vi.fn()}
      />,
    );
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByTitle('Regional coalition')).toBeInTheDocument();
    expect(screen.getByText('🚀')).toBeInTheDocument();
  });
});
