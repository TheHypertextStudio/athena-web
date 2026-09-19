import '@testing-library/jest-dom/vitest';

import { cleanup, render, renderHook, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { prefetchAuthenticatedRoute } = vi.hoisted(() => ({
  prefetchAuthenticatedRoute: vi.fn(() => Promise.resolve(true)),
}));

vi.mock('../../src/components/docket-link', () => ({
  default: ({
    href,
    children,
    ...rest
  }: { href: string; children: ReactNode } & Record<string, unknown>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock('../../src/lib/authenticated-route', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  prefetchAuthenticatedRoute,
}));

import {
  PROJECT_LENS_COPY,
  PROJECT_LENS_TRANSITION,
  ProjectLensSwitch,
  projectDependenciesHref,
  projectRosterHref,
  useWarmProjectLens,
} from '../../src/components/work-views/project-lens-frame';

const ORG_ID = '01K3CQWKHQ3GXESM7K1YS55P9A';

beforeEach(() => {
  prefetchAuthenticatedRoute.mockClear();
});

afterEach(cleanup);

describe('project lens frame', () => {
  it('names the two Projects pages from the workspace id', () => {
    expect(projectRosterHref(ORG_ID)).toBe(`/orgs/${ORG_ID}/projects`);
    expect(projectDependenciesHref(ORG_ID)).toBe(`/orgs/${ORG_ID}/projects/dependencies`);
  });

  it('shares the vocabulary title between the pages', () => {
    expect(PROJECT_LENS_COPY.title).toBe('Projects');
  });

  it('gives each shared element its own transition name', () => {
    const names = Object.values(PROJECT_LENS_TRANSITION);

    expect(new Set(names).size).toBe(names.length);
  });

  it('switches to the roster through a link and marks Dependencies as the current page', () => {
    render(<ProjectLensSwitch orgId={ORG_ID} />);

    const list = screen.getByRole('tab', { name: 'List' });
    expect(list).toHaveAttribute('href', `/orgs/${ORG_ID}/projects`);
    expect(list).toHaveAttribute('aria-selected', 'false');
    const dependencies = screen.getByRole('tab', { name: 'Dependencies' });
    expect(dependencies).toHaveAttribute('aria-selected', 'true');
    expect(dependencies).toHaveAttribute('aria-current', 'page');
  });

  it('morphs the switch into place when moving to the roster', () => {
    render(<ProjectLensSwitch orgId={ORG_ID} />);

    expect(screen.getByRole('tab', { name: 'List' })).toHaveAttribute(
      'transition',
      'shared-element',
    );
    expect(screen.getByRole('tablist').style.viewTransitionName).toBe(PROJECT_LENS_TRANSITION.lens);
  });

  it('loads the other page while this one is open', () => {
    renderHook(() => {
      useWarmProjectLens(ORG_ID, 'dependencies');
    });

    expect(prefetchAuthenticatedRoute).toHaveBeenCalledWith(
      `/orgs/${ORG_ID}/projects/dependencies`,
    );
  });

  it('loads the roster from the dependencies page', () => {
    renderHook(() => {
      useWarmProjectLens(ORG_ID, 'roster');
    });

    expect(prefetchAuthenticatedRoute).toHaveBeenCalledWith(`/orgs/${ORG_ID}/projects`);
  });

  it('loads nothing when the page has no lens switch', () => {
    renderHook(() => {
      useWarmProjectLens(ORG_ID, 'dependencies', false);
    });

    expect(prefetchAuthenticatedRoute).not.toHaveBeenCalled();
  });

  it('shrugs off a failed load so the navigation just swaps instantly', async () => {
    prefetchAuthenticatedRoute.mockRejectedValueOnce(new Error('chunk failed'));

    renderHook(() => {
      useWarmProjectLens(ORG_ID, 'dependencies');
    });

    await Promise.resolve();
    expect(prefetchAuthenticatedRoute).toHaveBeenCalledTimes(1);
  });
});
