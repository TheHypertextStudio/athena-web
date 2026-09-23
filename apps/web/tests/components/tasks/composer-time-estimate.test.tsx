/**
 * The composer's time-estimate chip shows the estimate the task will be created with: the picked
 * time, else the one a `~` title token names. Clearing it takes the token out of the title.
 */
import '@testing-library/jest-dom/vitest';

import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ComposerTimeEstimate } from '@/components/tasks/composer-time-estimate';

vi.mock('@/components/views/entity-detail-layout', () => ({
  EntityMetadataItem: ({ children }: { readonly children: React.ReactNode }) => children,
}));

describe('ComposerTimeEstimate', () => {
  it('previews the estimate a title token names', () => {
    render(
      <ComposerTimeEstimate
        title="Draft the brief ~45m"
        value={null}
        onChange={vi.fn()}
        onTitleChange={vi.fn()}
        disabled={false}
      />,
    );

    expect(screen.getByRole('button', { name: /^Time estimate/ })).toHaveTextContent('0:45');
  });

  it('shows a picked estimate over a title token', () => {
    render(
      <ComposerTimeEstimate
        title="Draft ~45m"
        value={120}
        onChange={vi.fn()}
        onTitleChange={vi.fn()}
        disabled={false}
      />,
    );

    expect(screen.getByRole('button', { name: /^Time estimate/ })).toHaveTextContent('2:00');
  });

  it('takes the token out of the title when cleared', async () => {
    const onChange = vi.fn();
    const onTitleChange = vi.fn();
    render(
      <ComposerTimeEstimate
        title="Draft the brief ~45m"
        value={null}
        onChange={onChange}
        onTitleChange={onTitleChange}
        disabled={false}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /^Time estimate/ }));
    const [clear] = await screen.findAllByRole('option');
    expect(clear).toBeDefined();
    if (clear === undefined) return;
    fireEvent.click(within(clear).getByRole('button'));

    expect(onTitleChange).toHaveBeenCalledWith('Draft the brief');
    expect(onChange).toHaveBeenCalledWith(null);
  });
});
