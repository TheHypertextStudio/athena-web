import '@testing-library/jest-dom/vitest';

import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import {
  EntityDetailLayout,
  EntityMetadataItem,
  EntityMetadataRow,
} from '../../src/components/views/entity-detail-layout';

describe('EntityDetailLayout', () => {
  it('keeps object context on a masthead that cannot be dragged', () => {
    const { container } = render(
      <EntityDetailLayout
        object={{
          kind: 'project',
          id: 'project-1',
          organizationId: 'org-1',
          title: 'Launch',
        }}
        icon={<span>icon</span>}
        title="Launch"
        actions={<button type="button">Publish</button>}
        tabs={<div>tabs</div>}
      >
        <div>body</div>
      </EntityDetailLayout>,
    );

    const header = container.querySelector('header');
    expect(header).toHaveAttribute('data-object-kind', 'project');
    expect(header).toHaveAttribute('draggable', 'false');
    expect(header).not.toHaveClass('cursor-grab');

    const primary = header?.querySelector('.detail-primary');
    expect(primary).not.toBeNull();
    expect(within(primary as HTMLElement).getByRole('button', { name: 'Publish' })).toBeVisible();
    expect(primary?.querySelector('.detail-identity')).not.toBeNull();
  });
});

describe('EntityMetadataRow', () => {
  it('keeps one inline row and preserves every property in its overflow popover', async () => {
    render(
      <EntityMetadataRow ariaLabel="Project properties">
        <EntityMetadataItem priority={0}>
          <button type="button">Status</button>
        </EntityMetadataItem>
        <EntityMetadataItem priority={1}>
          <button type="button">Health</button>
        </EntityMetadataItem>
      </EntityMetadataRow>,
    );

    const row = screen.getByRole('group', { name: 'Project properties' });
    expect(row).toHaveClass('flex-nowrap');
    expect(row.querySelector('[data-entity-metadata-inline]')).toHaveClass('flex-nowrap');

    fireEvent.click(screen.getByRole('button', { name: 'More Project properties' }));
    const overflow = await screen.findByRole('group', {
      name: 'More Project properties',
    });
    expect(within(overflow).getByRole('button', { name: 'Status' })).toBeVisible();
    expect(within(overflow).getByRole('button', { name: 'Health' })).toBeVisible();
  });
});
