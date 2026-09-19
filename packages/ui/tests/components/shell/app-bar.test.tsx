import '@testing-library/jest-dom/vitest';

import { render, screen } from '@testing-library/react';
import * as React from 'react';
import { describe, expect, it } from 'vitest';

import { AppBar } from '../../../src/components/shell/AppBar';

describe('AppBar', () => {
  it('renders the band as a header with the controls on their own row', () => {
    render(
      <AppBar
        title="Dependency graph"
        navigation={<button type="button">Back</button>}
        actions={<button type="button">Share</button>}
        controls={<input aria-label="Search" />}
      />,
    );
    const header = screen.getByRole('banner');
    expect(header).toHaveClass('flex-col');
    const heading = screen.getByRole('heading', { level: 1 });
    const search = screen.getByRole('textbox', { name: 'Search' });
    // The controls sit in a sibling row of the title row.
    expect(heading.parentElement).not.toBe(search.parentElement);
    expect(header).toContainElement(search);
  });

  it('renders the floating presentation as one named region with the controls inline', () => {
    render(
      <AppBar
        presentation="floating"
        aria-label="Plan"
        title="Spring giving campaign"
        navigation={<button type="button">Back</button>}
        actions={<button type="button">Athena</button>}
        controls={<input aria-label="Search the plan" />}
      />,
    );
    const region = screen.getByRole('region', { name: 'Plan' });
    expect(region).not.toHaveClass('flex-col');
    expect(region).toHaveAttribute('data-surface-tone', 'floating');
    const heading = screen.getByRole('heading', { level: 1 });
    const search = screen.getByRole('textbox', { name: 'Search the plan' });
    expect(region).toContainElement(heading);
    expect(region).toContainElement(search);
    // Navigation, title, controls, actions read in that order.
    const order = [
      screen.getByRole('button', { name: 'Back' }),
      heading,
      search,
      screen.getByRole('button', { name: 'Athena' }),
    ].map((element) => region.compareDocumentPosition(element));
    expect(order.every((flag) => flag & Node.DOCUMENT_POSITION_CONTAINED_BY)).toBe(true);
    expect(
      screen
        .getByRole('button', { name: 'Back' })
        .compareDocumentPosition(screen.getByRole('button', { name: 'Athena' })) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('names the heading for a shared-element transition in either presentation', () => {
    const { rerender } = render(<AppBar title="Projects" titleTransitionName="lens-title" />);
    expect(screen.getByRole('heading', { level: 1 }).style.viewTransitionName).toBe('lens-title');

    rerender(
      <AppBar
        presentation="floating"
        aria-label="Projects"
        title="Projects"
        titleTransitionName="lens-title"
      />,
    );
    expect(screen.getByRole('heading', { level: 1 }).style.viewTransitionName).toBe('lens-title');
  });

  it('leaves the heading unnamed when no transition name is given', () => {
    render(<AppBar title="Projects" />);

    expect(screen.getByRole('heading', { level: 1 }).style.viewTransitionName).toBeFalsy();
  });
});
