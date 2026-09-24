import '@testing-library/jest-dom/vitest';

import { fireEvent, render, screen, within } from '@testing-library/react';
import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { TabBar, type OpenTab } from '../../../src/components/shell/TabBar';
import { assertDefined } from '@docket/test-utils';

function renderLink(href: string, content: React.ReactNode, className?: string): React.ReactNode {
  return (
    <a href={href} className={className}>
      {content}
    </a>
  );
}

const TABS: readonly OpenTab[] = Array.from({ length: 32 }, (_, index) => ({
  key: `task:o1:t${String(index + 1)}`,
  type: 'task',
  orgId: 'o1',
  id: `t${String(index + 1)}`,
  title: `Open document ${String(index + 1)}`,
  href: `/orgs/o1/tasks/t${String(index + 1)}`,
}));

describe('TabBar crowded state', () => {
  it('keeps thirty-two documents reachable through the strip and searchable switcher', async () => {
    const onClose = vi.fn();
    render(
      <TabBar tabs={TABS} activeKey={TABS[31]?.key} renderLink={renderLink} onClose={onClose} />,
    );

    const strip = screen.getByRole('tablist', { name: 'Open documents' });
    expect(within(strip).getAllByRole('tab')).toHaveLength(3);
    expect(within(strip).getByRole('link', { name: 'Open document 30' })).toHaveAttribute(
      'href',
      '/orgs/o1/tasks/t30',
    );
    expect(within(strip).getByRole('link', { name: 'Open document 31' })).toBeInTheDocument();
    expect(within(strip).queryByText('Open document 29')).not.toBeInTheDocument();
    const active = assertDefined(
      within(strip).getByText('Open document 32').closest<HTMLElement>('[role="tab"]'),
    );
    expect(active).toHaveAttribute('aria-selected', 'true');
    expect(
      within(active).getByRole('button', { name: 'Close Open document 32' }),
    ).toBeInTheDocument();

    const trigger = screen.getByRole('button', { name: 'Open documents (32)' });
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
    fireEvent.click(trigger);
    const switcher = await screen.findByRole('dialog', { name: 'Open documents' });
    expect(within(switcher).getAllByRole('listitem')).toHaveLength(32);
    const search = within(switcher).getByRole('searchbox', { name: 'Search open documents' });
    expect(search).toHaveFocus();
    fireEvent.keyDown(search, { key: 'ArrowDown' });
    expect(within(switcher).getByRole('link', { name: 'Open document 1' })).toHaveFocus();
    fireEvent.change(search, { target: { value: 'document 17' } });
    expect(within(switcher).getByRole('link', { name: 'Open document 17' })).toHaveAttribute(
      'href',
      '/orgs/o1/tasks/t17',
    );
    fireEvent.click(within(switcher).getByRole('button', { name: 'Close Open document 17' }));
    expect(onClose).toHaveBeenCalledWith('task:o1:t17');
  });

  it('shows neighbors around a middle selection and recent tabs without a selection', () => {
    const { rerender } = render(
      <TabBar
        tabs={TABS}
        activeKey={TABS[16]?.key}
        renderLink={renderLink}
        onClose={() => undefined}
      />,
    );
    const strip = screen.getByRole('tablist', { name: 'Open documents' });
    expect(
      within(strip)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['Open document 16', 'Open document 17', 'Open document 18']);

    rerender(<TabBar tabs={TABS} renderLink={renderLink} onClose={() => undefined} />);
    expect(
      within(strip)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['Open document 30', 'Open document 31', 'Open document 32']);
  });

  it('keeps five documents in the strip before switching to a compact crowded state', () => {
    const { rerender } = render(
      <TabBar tabs={TABS.slice(0, 5)} renderLink={renderLink} onClose={() => undefined} />,
    );
    const strip = screen.getByRole('tablist', { name: 'Open documents' });
    expect(within(strip).getAllByRole('tab')).toHaveLength(5);

    rerender(<TabBar tabs={TABS.slice(0, 6)} renderLink={renderLink} onClose={() => undefined} />);
    expect(within(strip).getAllByRole('tab')).toHaveLength(3);
    expect(screen.getByRole('button', { name: 'Open documents (6)' })).toBeInTheDocument();
  });

  it('brings the active document into view when selection changes', () => {
    const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView');
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    });
    try {
      const { rerender } = render(
        <TabBar
          tabs={TABS}
          activeKey={TABS[0]?.key}
          renderLink={renderLink}
          onClose={() => undefined}
        />,
      );
      expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest' });
      expect(
        screen.getByRole('tablist', { name: 'Open documents' }).querySelectorAll('[role="tab"]'),
      ).toHaveLength(3);
      scrollIntoView.mockClear();
      rerender(
        <TabBar
          tabs={TABS}
          activeKey={TABS[31]?.key}
          renderLink={renderLink}
          onClose={() => undefined}
        />,
      );
      expect(scrollIntoView).toHaveBeenCalledTimes(1);
      expect(scrollIntoView.mock.contexts[0]).toBe(
        screen.getByText('Open document 32').closest('[role="tab"]'),
      );
    } finally {
      if (original) Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', original);
      else Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
    }
  });
});
