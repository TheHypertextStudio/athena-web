import { describe, expect, it } from 'vitest';

import {
  describeParentResolution,
  resolveWorkParent,
  type ParentCandidate,
} from '../src/parent-resolution';

/** A workspace with real structure: two initiatives and four projects beneath them. */
const CANDIDATES: readonly ParentCandidate[] = [
  {
    id: 'ini_growth',
    kind: 'initiative',
    title: 'Grow paid subscribers',
    description: 'Everything that moves paid subscriber count for the year.',
  },
  {
    id: 'prj_newsletter',
    kind: 'project',
    title: 'Weekly newsletter relaunch',
    description: 'Rebuild the newsletter template, cadence and Substack import.',
  },
  {
    id: 'prj_pricing',
    kind: 'project',
    title: 'Pricing page rewrite',
    description: 'New pricing tiers, copy and the checkout flow.',
  },
  {
    id: 'ini_platform',
    kind: 'initiative',
    title: 'Platform reliability',
    description: 'Uptime, incident response and the database.',
  },
  {
    id: 'prj_migration',
    kind: 'project',
    title: 'Postgres upgrade',
    description: 'Move the primary database to Postgres 17 with zero downtime.',
  },
  {
    id: 'prj_hiring',
    kind: 'project',
    title: 'Designer hiring loop',
    description: 'Scorecards, portfolio review and the onsite for the brand designer role.',
  },
  {
    id: 'prj_archived',
    kind: 'project',
    title: 'Newsletter sponsorship pilot',
    description: 'Closed out last quarter.',
    open: false,
  },
];

const FIXTURE: readonly { readonly request: string; readonly expected: string | null }[] = [
  { request: 'Draft the newsletter template for next week', expected: 'prj_newsletter' },
  { request: 'Import the old Substack archive into the newsletter', expected: 'prj_newsletter' },
  { request: 'Rewrite the pricing tiers copy on the pricing page', expected: 'prj_pricing' },
  { request: 'Fix the checkout flow on pricing', expected: 'prj_pricing' },
  { request: 'Plan the zero downtime Postgres upgrade rehearsal', expected: 'prj_migration' },
  { request: 'Move the primary database off the old Postgres box', expected: 'prj_migration' },
  { request: 'Write the portfolio review scorecard for the designer role', expected: 'prj_hiring' },
  { request: 'Schedule the brand designer onsite loop', expected: 'prj_hiring' },
  { request: 'Book a dentist appointment for Thursday morning', expected: null },
  { request: 'Order more coffee filters for the kitchen', expected: null },
];

describe('resolveWorkParent', () => {
  it('links requests with an existing objective to the right parent', () => {
    for (const entry of FIXTURE.filter((candidate) => candidate.expected !== null)) {
      const resolution = resolveWorkParent(entry.request, CANDIDATES);

      expect(resolution.reason, entry.request).toBe('matched');
      expect(resolution.parent?.id, entry.request).toBe(entry.expected);
    }
  });

  it('leaves unrelated work unlinked and explains why', () => {
    for (const entry of FIXTURE.filter((candidate) => candidate.expected === null)) {
      const resolution = resolveWorkParent(entry.request, CANDIDATES);

      expect(resolution.parent, entry.request).toBeNull();
      expect(resolution.reason, entry.request).toBe('below-threshold');
      expect(describeParentResolution(resolution)).toContain('Created without a parent');
    }
  });

  it('never files work under a closed container', () => {
    const resolution = resolveWorkParent('newsletter sponsorship pilot follow-up', CANDIDATES);

    expect(resolution.parent?.id).not.toBe('prj_archived');
    expect(resolution.considered).toBe(CANDIDATES.length - 1);
  });

  it('prefers the more specific container when two candidates tie', () => {
    const tied: readonly ParentCandidate[] = [
      { id: 'ini_x', kind: 'initiative', title: 'Quarterly onboarding overhaul' },
      { id: 'prj_x', kind: 'project', title: 'Quarterly onboarding overhaul' },
    ];

    expect(resolveWorkParent('rework quarterly onboarding overhaul', tied).parent?.id).toBe(
      'prj_x',
    );
  });

  it('reports no candidates when the workspace has none or the request has no terms', () => {
    const emptyWorkspace = resolveWorkParent('anything at all', []);
    expect(emptyWorkspace.reason).toBe('no-candidates');
    expect(emptyWorkspace.considered).toBe(0);
    expect(describeParentResolution(emptyWorkspace)).toContain('no open project or initiative');
    expect(resolveWorkParent('do it', CANDIDATES).reason).toBe('no-candidates');
  });

  it('does not let a shared common word capture unrelated work', () => {
    const generic: readonly ParentCandidate[] = [
      { id: 'p1', kind: 'project', title: 'Weekly planning ritual' },
      { id: 'p2', kind: 'project', title: 'Weekly metrics review' },
      { id: 'p3', kind: 'project', title: 'Weekly customer calls' },
    ];

    expect(resolveWorkParent('weekly something unrelated', generic).parent).toBeNull();
  });

  it('exposes matched terms and uses caller-supplied parent vocabulary in the explanation', () => {
    const resolution = resolveWorkParent('import the substack archive', CANDIDATES);

    expect(resolution.matchedTerms).toContain('substack');
    expect(describeParentResolution(resolution)).toBe(
      'Filed under the project “Weekly newsletter relaunch”.',
    );
    expect(
      describeParentResolution(resolution, {
        project: 'workstream',
        initiative: 'bet',
        program: 'portfolio',
        milestone: 'checkpoint',
      }),
    ).toBe('Filed under the workstream “Weekly newsletter relaunch”.');
  });

  it('honours a threshold override in both directions', () => {
    expect(resolveWorkParent('weekly', CANDIDATES, { threshold: 0.1 }).parent).not.toBeNull();
    expect(
      resolveWorkParent('import the substack archive', CANDIDATES, { threshold: 99 }).parent,
    ).toBeNull();
  });
});
