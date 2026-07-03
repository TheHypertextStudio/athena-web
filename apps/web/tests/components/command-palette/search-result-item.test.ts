import { describe, expect, it, vi } from 'vitest';

import { OrganizationId, type SearchResult } from '@docket/types';

import { searchResultToPaletteItem } from '@/components/command-palette/use-hub-search';

const ORG = OrganizationId.parse('01HZX5K3QJ9F8B7C6D5E4F3G2H');

function result(overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    id: 'doc_1',
    organizationId: ORG,
    userId: null,
    kind: 'task',
    family: 'work',
    title: 'Ship beta',
    summary: 'Release checklist',
    snippet: 'Release checklist',
    matchedFields: ['title'],
    route: {
      type: 'entity',
      organizationId: ORG,
      entityKind: 'task',
      entityId: 'task_1',
      href: `/orgs/${ORG}/tasks/task_1`,
    },
    subject: null,
    source: null,
    facets: {},
    actions: [],
    score: 10,
    ...overrides,
  };
}

describe('searchResultToPaletteItem', () => {
  it('maps semantic task results to routable palette rows', () => {
    const push = vi.fn();
    const close = vi.fn();

    const item = searchResultToPaletteItem(result(), {
      close,
      orgName: () => 'Acme',
      navigate: push,
    });

    expect(item).toMatchObject({
      id: 'hit:doc_1',
      section: 'results',
      label: 'Ship beta',
      hint: 'Release checklist',
      hitType: 'task',
      org: { id: ORG, name: 'Acme' },
    });

    item.run();
    expect(close).toHaveBeenCalledOnce();
    expect(push).toHaveBeenCalledWith(`/orgs/${ORG}/tasks/task_1`);
  });

  it('uses subject context for content results', () => {
    const item = searchResultToPaletteItem(
      result({
        id: 'doc_comment',
        kind: 'comment',
        family: 'content',
        title: 'Comment on project',
        summary: null,
        subject: { kind: 'project', id: 'project_1', title: 'Billing', organizationId: ORG },
        route: {
          type: 'content',
          organizationId: ORG,
          subjectKind: 'project',
          subjectId: 'project_1',
          contentKind: 'comment',
          contentId: 'comment_1',
          href: `/orgs/${ORG}/search?subjectKind=project&subjectId=project_1&commentId=comment_1`,
        },
      }),
      { close: vi.fn(), orgName: () => 'Acme', navigate: vi.fn() },
    );

    expect(item.hint).toBe('Project: Billing');
  });

  it('preserves source attribution for integration-backed results', () => {
    const item = searchResultToPaletteItem(
      result({
        kind: 'activity',
        family: 'activity',
        title: 'Issue moved',
        source: {
          system: 'github',
          externalUrl: 'https://github.com/acme/app/issues/1',
          eventId: 'event_1',
        },
        route: {
          type: 'activity',
          organizationId: ORG,
          eventId: 'event_1',
          href: `/orgs/${ORG}/stream?eventId=event_1`,
          externalUrl: 'https://github.com/acme/app/issues/1',
        },
      }),
      { close: vi.fn(), orgName: () => 'Acme', navigate: vi.fn() },
    );

    expect(item.source).toBe('GitHub');
  });

  it('can navigate external activity results without Next router', () => {
    const navigateExternal = vi.fn();
    const item = searchResultToPaletteItem(
      result({
        kind: 'activity',
        family: 'activity',
        route: {
          type: 'activity',
          organizationId: ORG,
          eventId: 'event_1',
          href: `/orgs/${ORG}/stream?eventId=event_1`,
          externalUrl: 'https://linear.app/acme/issue/ENG-1',
        },
      }),
      { close: vi.fn(), orgName: () => 'Acme', navigate: vi.fn(), navigateExternal },
    );

    item.run();
    expect(navigateExternal).toHaveBeenCalledWith('https://linear.app/acme/issue/ENG-1');
  });
});
