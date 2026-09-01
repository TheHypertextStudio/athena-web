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

  it('separates an inset toolbar from the masthead with shared page rhythm', () => {
    render(
      <ListPageLayout
        title="Initiatives"
        fill
        toolbar={<button type="button">All initiatives</button>}
      >
        <p>Initiative list</p>
      </ListPageLayout>,
    );

    const masthead = screen.getByRole('heading', { name: 'Initiatives' }).closest('header');
    const toolbar = screen.getByRole('button', { name: 'All initiatives' });
    const toolbarBand = toolbar.parentElement;

    expect(masthead).toBeInTheDocument();
    expect(toolbarBand).toContainElement(masthead);
    expect(toolbarBand).toHaveClass('flex', 'flex-col', 'gap-3', '@2xl:gap-4');
  });
});
