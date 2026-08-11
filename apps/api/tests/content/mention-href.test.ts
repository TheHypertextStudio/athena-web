/**
 * Every mentionable kind routes somewhere, and somewhere real.
 *
 * @remarks
 * The switch this covers has no default arm on purpose — adding a mentionable kind is meant to
 * fail the build until its route exists. That guarantee only holds at compile time, though: it
 * says every kind is *handled*, not that the path it produces is one the app serves. A chip whose
 * href points at a route that does not exist navigates to a 404, and nothing about that is a type
 * error. So the table below names the expected path for each kind explicitly rather than deriving
 * it, and the exhaustiveness check keeps the table honest as kinds are added.
 */
import { describe, expect, it } from 'vitest';

import { MentionEntityKind as MentionEntityKindSchema } from '@docket/types';

import { entityMentionHref } from '../../src/content/mention-href';

/** Every kind the reference vocabulary declares. */
const KINDS = MentionEntityKindSchema.options;
type Kind = (typeof KINDS)[number];

const ORG = 'org_1';
const ID = 'e_1';

/** The served in-app destination for each mention kind, written out rather than derived. */
const EXPECTED: Readonly<Record<Kind, string>> = {
  task: `/orgs/${ORG}/tasks/${ID}`,
  project: `/orgs/${ORG}/projects/${ID}`,
  program: `/orgs/${ORG}/programs/${ID}`,
  initiative: `/orgs/${ORG}/initiatives/${ID}`,
  cycle: `/orgs/${ORG}/cycles/${ID}`,
  milestone: `/orgs/${ORG}/projects?milestoneId=${ID}`,
  team: `/orgs/${ORG}/teams/${ID}`,
  actor: `/orgs/${ORG}/people/${ID}`,
  agent_session: `/orgs/${ORG}/sessions/${ID}`,
  comment: `/orgs/${ORG}/search?kind=comment&id=${ID}`,
  update: `/orgs/${ORG}/search?kind=update&id=${ID}`,
};

describe('entityMentionHref', () => {
  it.each(KINDS)('routes a %s reference to its own surface', (entityKind) => {
    expect(entityMentionHref(ORG, { kind: 'entity', entityKind, entityId: ID })).toBe(
      EXPECTED[entityKind],
    );
  });

  it('covers every kind the vocabulary declares, so a new one cannot slip through untested', () => {
    expect(Object.keys(EXPECTED).sort()).toEqual([...KINDS].sort());
  });

  it('scopes the path to the workspace, because ids are only unique within one', () => {
    const ref = { kind: 'entity', entityKind: 'task', entityId: ID } as const;
    expect(entityMentionHref('org_a', ref)).not.toBe(entityMentionHref('org_b', ref));
  });
});
