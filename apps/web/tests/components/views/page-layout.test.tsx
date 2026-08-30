import '@testing-library/jest-dom/vitest';

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ListPageLayout } from '../../../src/components/views/page-layout';

describe('ListPageLayout', () => {
  it('keeps document content inset by default', () => {
    render(
      <ListPageLayout title="Projects" fill>
        <p>Project list</p>
      </ListPageLayout>,
    );

    expect(screen.getByText('Project list').parentElement).toHaveAttribute(
      'data-page-body-presentation',
      'inset',
    );
  });

  it('keeps header and toolbar available while a canvas body reaches the page frame', () => {
    render(
      <ListPageLayout
        title="Projects"
        fill
        bodyPresentation="full-bleed"
        toolbar={<button type="button">Display</button>}
      >
        <section aria-label="Dependency canvas">Canvas</section>
      </ListPageLayout>,
    );

    expect(screen.getByRole('heading', { name: 'Projects' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Display' })).toBeVisible();
    expect(screen.getByLabelText('Dependency canvas').parentElement).toHaveAttribute(
      'data-page-body-presentation',
      'full-bleed',
    );
  });
});
