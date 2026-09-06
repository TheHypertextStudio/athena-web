import '@testing-library/jest-dom/vitest';

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

vi.mock('@/components/docket-link', () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

import PlanStartCard, { parsePlanStart } from '../../src/components/plan-canvas/plan-start-card';

afterEach(() => {
  cleanup();
});

describe('parsePlanStart', () => {
  it('reads a plan_start payload and defaults what it can', () => {
    expect(
      parsePlanStart(
        JSON.stringify({
          planId: 'plan_1',
          href: '/orgs/org_1/plans/plan_1',
          title: 'Spring',
          counts: { projects: 2, tasks: 'x' },
        }),
      ),
    ).toEqual({
      planId: 'plan_1',
      href: '/orgs/org_1/plans/plan_1',
      title: 'Spring',
      counts: { projects: 2, tasks: 0, draft: 0 },
    });
    expect(
      parsePlanStart(JSON.stringify({ planId: 'plan_1', href: '/orgs/org_1/plans/x' })),
    ).toMatchObject({
      title: 'New plan',
    });
  });

  it('refuses anything that is not a plan on a canvas route', () => {
    expect(parsePlanStart('not json')).toBeNull();
    expect(parsePlanStart(42)).toBeNull();
    expect(parsePlanStart(JSON.stringify({ href: '/orgs/org_1/plans/x' }))).toBeNull();
    expect(
      parsePlanStart(JSON.stringify({ planId: 'p', href: 'https://evil.example/plans/x' })),
    ).toBeNull();
  });
});

describe('PlanStartCard', () => {
  it('links to the canvas route and names the plan', () => {
    render(
      <PlanStartCard
        plan={{
          planId: 'plan_1',
          href: '/orgs/org_1/plans/plan_1',
          title: 'Spring campaign',
          counts: { projects: 3, tasks: 7, draft: 5 },
        }}
      />,
    );
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', '/orgs/org_1/plans/plan_1');
    expect(link).toHaveTextContent('Spring campaign');
    expect(link).toHaveTextContent('3 projects');
  });
});
