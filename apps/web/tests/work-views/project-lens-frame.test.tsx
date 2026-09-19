import '@testing-library/jest-dom/vitest';

import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

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

import {
  PROJECT_LENS_COPY,
  ProjectLensSwitch,
  projectDependenciesHref,
  projectRosterHref,
} from '../../src/components/work-views/project-lens-frame';

const ORG_ID = '01K3CQWKHQ3GXESM7K1YS55P9A';

afterEach(cleanup);

describe('project lens frame', () => {
  it('names the two Projects pages from the workspace id', () => {
    expect(projectRosterHref(ORG_ID)).toBe(`/orgs/${ORG_ID}/projects`);
    expect(projectDependenciesHref(ORG_ID)).toBe(`/orgs/${ORG_ID}/projects/dependencies`);
  });

  it('shares the vocabulary title between the pages', () => {
    expect(PROJECT_LENS_COPY.title).toBe('Projects');
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
});
