/**
 * Unit tests for the open-documents route → document-ref matcher.
 *
 * @remarks
 * {@link tabRefFromPath} is the pure logic that decides whether a pathname opens a tab, and for
 * which document. The contract that must stay correct independent of the React tree:
 *
 * - a real detail route (`/orgs/:orgId/:segment/:id`) with ULID org + id resolves to its
 *   {@link TabRef} for every tabbable kind (task/project/initiative/program/cycle/session);
 * - list/cross-org/unknown-segment routes resolve to `null` (no tab is active);
 * - a malformed id segment — above all the literal `undefined` (which produced the infamous
 *   "Session undefi…" junk tab) — resolves to `null`, so no junk tab is ever opened.
 */
import { describe, expect, it } from 'vitest';

import { tabRefFromPath } from '@/components/tabs/route-tabs';

const ORG = '01HZX5K3QJ9F8B7C6D5E4F3G2H';
const ID = '01HZX5K3QJ9F8B7C6D5E4F3G2J';

describe('tabRefFromPath', () => {
  it('resolves a detail route to its document ref for every tabbable kind', () => {
    const cases = [
      ['tasks', 'task'],
      ['projects', 'project'],
      ['initiatives', 'initiative'],
      ['programs', 'program'],
      ['cycles', 'cycle'],
      ['sessions', 'session'],
    ] as const;
    for (const [segment, type] of cases) {
      expect(tabRefFromPath(`/orgs/${ORG}/${segment}/${ID}`)).toEqual({ type, orgId: ORG, id: ID });
    }
  });

  it('tolerates a trailing sub-path on a detail route (e.g. a sub-tab)', () => {
    expect(tabRefFromPath(`/orgs/${ORG}/sessions/${ID}/activity`)).toEqual({
      type: 'session',
      orgId: ORG,
      id: ID,
    });
  });

  it('returns null for list, cross-org, and unknown-segment routes', () => {
    expect(tabRefFromPath(`/orgs/${ORG}/tasks`)).toBeNull();
    expect(tabRefFromPath('/today')).toBeNull();
    expect(tabRefFromPath('/inbox')).toBeNull();
    expect(tabRefFromPath(`/orgs/${ORG}/settings/${ID}`)).toBeNull();
  });

  it('returns null when the id segment is the literal "undefined" — no "Session undefined" tab', () => {
    // This is the session-tab bug: a link interpolated an `undefined` id into the URL. The
    // matcher must reject it so the store never opens a tab with a junk id/title.
    expect(tabRefFromPath(`/orgs/${ORG}/sessions/undefined`)).toBeNull();
    expect(tabRefFromPath(`/orgs/${ORG}/tasks/undefined`)).toBeNull();
  });

  it('returns null when the id or org segment is not a real ULID', () => {
    expect(tabRefFromPath(`/orgs/${ORG}/sessions/not-a-ulid`)).toBeNull();
    expect(tabRefFromPath(`/orgs/not-a-ulid/sessions/${ID}`)).toBeNull();
  });
});
