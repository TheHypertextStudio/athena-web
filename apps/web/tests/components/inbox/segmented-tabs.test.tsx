import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SegmentedTabs } from '@/components/inbox/segmented-tabs';

describe('Inbox content categories', () => {
  it('keeps every feed directly reachable, including long labels', async () => {
    const onChange = vi.fn();
    render(
      <SegmentedTabs
        label="Inbox feeds"
        value="announcements"
        onChange={onChange}
        segments={[
          { id: 'all', label: 'All' },
          { id: 'announcements', label: 'Announcements' },
          { id: 'mentions', label: 'Mentions & assignments' },
        ]}
      />,
    );
    expect(screen.getAllByRole('tab')).toHaveLength(3);
    expect(screen.getByRole('tab', { name: 'Announcements' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await userEvent.setup().click(screen.getByRole('tab', { name: 'Mentions & assignments' }));
    expect(onChange).toHaveBeenCalledWith('mentions');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
});
