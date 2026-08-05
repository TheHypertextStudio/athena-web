import { describe, expect, it } from 'vitest';

import { matchPattern, matchRoutes, specificity } from '@/lib/route-match';

/**
 * A slice of the real route table, chosen for the cases that can go wrong: a catch-all competing
 * with its siblings, a two-param detail route, and two patterns of equal length where only a static
 * segment tells them apart.
 */
const PATTERNS = [
  '/today',
  '/orgs/[orgId]/tasks',
  '/orgs/[orgId]/tasks/[taskId]',
  '/orgs/[orgId]/settings',
  '/orgs/[orgId]/settings/members',
  '/orgs/[orgId]/[...unmatched]',
  '/athena/mail/[id]',
] as const;

describe('matchPattern', () => {
  it('matches a static route exactly', () => {
    expect(matchPattern('/today', '/today')).toEqual({ pattern: '/today', params: {} });
  });

  it('captures a single param', () => {
    expect(matchPattern('/orgs/[orgId]/tasks', '/orgs/abc/tasks')?.params).toEqual({
      orgId: 'abc',
    });
  });

  it('captures every param on a detail route', () => {
    expect(matchPattern('/orgs/[orgId]/tasks/[taskId]', '/orgs/abc/tasks/t-1')?.params).toEqual({
      orgId: 'abc',
      taskId: 't-1',
    });
  });

  it('rejects a path with a trailing segment the pattern does not account for', () => {
    expect(matchPattern('/orgs/[orgId]/tasks', '/orgs/abc/tasks/t-1')).toBeNull();
  });

  it('rejects a path that runs out of segments early', () => {
    expect(matchPattern('/orgs/[orgId]/tasks', '/orgs/abc')).toBeNull();
  });

  it('collects the rest of the path into a catch-all array', () => {
    expect(matchPattern('/orgs/[orgId]/[...unmatched]', '/orgs/abc/who/knows')?.params).toEqual({
      orgId: 'abc',
      unmatched: ['who', 'knows'],
    });
  });

  it('does not let a catch-all match its own parent path', () => {
    // `[[...x]]` — the optional form, which would match — is not used anywhere in this app.
    expect(matchPattern('/orgs/[orgId]/[...unmatched]', '/orgs/abc')).toBeNull();
  });

  it('decodes percent-encoded segments', () => {
    expect(matchPattern('/athena/mail/[id]', '/athena/mail/a%2Fb')?.params).toEqual({
      id: 'a/b',
    });
  });
});

describe('specificity', () => {
  it('ranks a static segment above a param in the same position', () => {
    expect(specificity('/orgs/[orgId]/settings/members')).toBeGreaterThan(
      specificity('/orgs/[orgId]/settings/[tab]'),
    );
  });

  it('ranks any fixed-arity pattern above a catch-all', () => {
    expect(specificity('/orgs/[orgId]/tasks')).toBeGreaterThan(
      specificity('/orgs/[orgId]/[...unmatched]'),
    );
  });
});

describe('matchRoutes', () => {
  it('prefers the static route over the catch-all that also matches', () => {
    expect(matchRoutes(PATTERNS, '/orgs/abc/tasks')?.pattern).toBe('/orgs/[orgId]/tasks');
  });

  it('prefers the detail route over the catch-all that also matches', () => {
    expect(matchRoutes(PATTERNS, '/orgs/abc/tasks/t-1')?.pattern).toBe(
      '/orgs/[orgId]/tasks/[taskId]',
    );
  });

  it('falls to the catch-all only when nothing else claims the path', () => {
    const match = matchRoutes(PATTERNS, '/orgs/abc/nonsense');
    expect(match?.pattern).toBe('/orgs/[orgId]/[...unmatched]');
    expect(match?.params).toEqual({ orgId: 'abc', unmatched: ['nonsense'] });
  });

  it('answers null for a path no route claims', () => {
    expect(matchRoutes(PATTERNS, '/sign-in')).toBeNull();
  });

  it('is unaffected by the order patterns are declared in', () => {
    const reversed = [...PATTERNS].reverse();
    expect(matchRoutes(reversed, '/orgs/abc/tasks')?.pattern).toBe('/orgs/[orgId]/tasks');
  });
});
