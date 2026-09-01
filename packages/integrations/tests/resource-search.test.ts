import { describe, expect, it } from 'vitest';

import { CONNECTOR_PROVIDER_IDS } from '@docket/connections/provider-catalog-contract';

import { MockConnector } from '../src/mock-connector';
import { RESOURCE_SEARCH_CAPABLE_PROVIDERS } from '../src/resource-search';
import { assertDefined } from '@docket/test-utils';

describe('the resource-search capability', () => {
  it.each([...CONNECTOR_PROVIDER_IDS])(
    'is offered by %s exactly when the manifest says so',
    (provider) => {
      const connector = new MockConnector({ provider });
      const offered = connector.asResourceSearch() !== undefined;
      expect(offered).toBe(RESOURCE_SEARCH_CAPABLE_PROVIDERS.has(provider));
    },
  );

  it('filters by title, newest first', async () => {
    const search = new MockConnector({ provider: 'drive' }).asResourceSearch();
    expect(search).toBeDefined();
    const page = await assertDefined(search).searchResources({
      connectionId: 'c1',
      query: 'launch',
      limit: 10,
    });
    expect(page.resources.map((r) => r.title)).toEqual(['Q3 launch plan', 'Launch budget']);
    expect(page.truncated).toBe(false);
  });

  it('matches case-insensitively', async () => {
    const search = new MockConnector({ provider: 'drive' }).asResourceSearch();
    const page = await assertDefined(search).searchResources({
      connectionId: 'c1',
      query: 'LAUNCH',
      limit: 10,
    });
    expect(page.resources).toHaveLength(2);
  });

  it('returns recents for an empty query, which is what bare @ asks for', async () => {
    const search = new MockConnector({ provider: 'drive' }).asResourceSearch();
    const page = await assertDefined(search).searchResources({
      connectionId: 'c1',
      query: '',
      limit: 3,
    });
    expect(page.resources).toHaveLength(3);
    // Truncation must be reported, or the client would narrow a cut page and hide real results.
    expect(page.truncated).toBe(true);
  });

  it('resolves one resource by id, and nothing for an unknown one', async () => {
    const search = new MockConnector({ provider: 'drive' }).asResourceSearch();
    await expect(
      assertDefined(search).resolveResource({ externalId: '01HZDRIVE0001' }),
    ).resolves.toMatchObject({
      title: 'Q3 launch plan',
    });
    await expect(
      assertDefined(search).resolveResource({ externalId: 'nope' }),
    ).resolves.toBeUndefined();
  });

  it("maps every fixture into Docket's own taxonomy rather than a provider MIME type", async () => {
    const search = new MockConnector({ provider: 'drive' }).asResourceSearch();
    const page = await assertDefined(search).searchResources({
      connectionId: 'c1',
      query: '',
      limit: 50,
    });
    for (const resource of page.resources) {
      expect(resource.resourceType).not.toContain('/');
      expect(resource.url.startsWith('https://')).toBe(true);
    }
  });
});

describe('Drive query escaping', () => {
  it("escapes a quote, which would otherwise 400 on every keystroke of a name like O'Brien", async () => {
    const { escapeDriveQuery } = await import('../src/google');
    expect(escapeDriveQuery("O'Brien")).toBe("O\\'Brien");
  });

  it('escapes the backslash first, or escaping the quote would undo itself', async () => {
    const { escapeDriveQuery } = await import('../src/google');
    expect(escapeDriveQuery("a\\'b")).toBe("a\\\\\\'b");
  });

  it('leaves an ordinary query untouched', async () => {
    const { escapeDriveQuery } = await import('../src/google');
    expect(escapeDriveQuery('launch plan')).toBe('launch plan');
  });
});
