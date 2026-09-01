import { describe, expect, it } from 'vitest';

import {
  RESOURCE_PROVIDER_LABEL,
  RESOURCE_PROVIDERS,
  ResourceProvider,
  providerForHost,
  resourceProviderById,
} from '../../src/contracts/resource-provider';
import { canonicalizeResourceUrl, matchProviderResourceUrl } from '../../src/contracts/resource';

describe('the provider registry', () => {
  it('declares every provider the wire enum allows, and nothing it does not', () => {
    const declared = [...RESOURCE_PROVIDERS.map((p) => p.id)].sort();
    const allowed = ResourceProvider.options.filter((id) => id !== 'web').sort();
    expect(declared).toEqual(allowed);
  });

  it('gives every provider a label, including the generic web fallback', () => {
    for (const id of ResourceProvider.options) {
      expect(RESOURCE_PROVIDER_LABEL[id]).toBeTruthy();
    }
  });

  it('uses ids that are unique and hosts that are lowercase', () => {
    const ids = RESOURCE_PROVIDERS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const provider of RESOURCE_PROVIDERS) {
      expect(provider.hosts.length).toBeGreaterThan(0);
      expect(provider.patterns.length).toBeGreaterThan(0);
      for (const host of provider.hosts) expect(host).toBe(host.toLowerCase());
    }
  });

  it('captures a resource id in group one of every pattern', () => {
    for (const provider of RESOURCE_PROVIDERS) {
      for (const { pattern } of provider.patterns) {
        // A pattern with no capture group would match a URL and then yield no id.
        expect(pattern.source).toContain('(');
      }
    }
  });

  it('resolves a provider by id', () => {
    expect(resourceProviderById('notion')?.label).toBe('Notion');
  });
});

describe('providerForHost', () => {
  it('matches an exact host', () => {
    expect(providerForHost('docs.google.com')?.id).toBe('google_drive');
  });

  it('matches a tenant subdomain, which is how SharePoint and Notion are addressed', () => {
    expect(providerForHost('contoso.sharepoint.com')?.id).toBe('sharepoint');
    expect(providerForHost('my-team.notion.site')?.id).toBe('notion');
    expect(providerForHost('acme.atlassian.net')?.id).toBe('confluence');
  });

  it('refuses a lookalike host that merely ends with the owned name', () => {
    expect(providerForHost('sharepoint.com.attacker.example')).toBeUndefined();
    expect(providerForHost('notdropbox.com')).toBeUndefined();
    expect(providerForHost('docs.google.com.evil.test')).toBeUndefined();
  });

  it('is case-insensitive about the host', () => {
    expect(providerForHost('Docs.Google.COM')?.id).toBe('google_drive');
  });
});

describe('matchProviderResourceUrl across sources', () => {
  it.each([
    ['https://docs.google.com/document/d/abc123/edit', 'google_drive', 'abc123', 'document'],
    ['https://drive.google.com/file/d/file4/view?usp=sharing', 'google_drive', 'file4', 'file'],
    ['https://drive.google.com/open?id=legacy1', 'google_drive', 'legacy1', 'unknown'],
    [
      'https://contoso.sharepoint.com/:w:/g/personal/ada_contoso_com/EQx7Report',
      'sharepoint',
      'EQx7Report',
      'file',
    ],
    ['https://contoso.sharepoint.com/sites/Platform/Home.aspx', 'sharepoint', 'Platform', 'page'],
    [
      'https://www.notion.so/Launch-plan-1f2e3d4c5b6a7988990a1b2c3d4e5f60',
      'notion',
      '1f2e3d4c5b6a7988990a1b2c3d4e5f60',
      'page',
    ],
    ['https://www.dropbox.com/scl/fi/abc987/plan.pdf', 'dropbox', 'abc987', 'file'],
    ['https://app.box.com/folder/2233', 'box', '2233', 'folder'],
    ['https://www.figma.com/design/Fig123/Docket', 'figma', 'Fig123', 'image'],
    [
      'https://acme.atlassian.net/wiki/spaces/ENG/pages/4815162342/Runbook',
      'confluence',
      '4815162342',
      'page',
    ],
  ])('recognizes %s', (url, provider, externalId, resourceType) => {
    expect(matchProviderResourceUrl(url)).toEqual({ provider, externalId, resourceType });
  });

  it('leaves an ordinary page to the generic web path', () => {
    expect(matchProviderResourceUrl('https://example.com/blog/post')).toBeUndefined();
  });

  it('refuses a recognized host over plain http, so a downgrade never gets a credential', () => {
    expect(matchProviderResourceUrl('http://docs.google.com/document/d/abc/edit')).toBeUndefined();
    expect(matchProviderResourceUrl('http://contoso.sharepoint.com/sites/X')).toBeUndefined();
  });

  it('does not claim a recognized host whose path names no resource', () => {
    expect(matchProviderResourceUrl('https://www.notion.so/')).toBeUndefined();
    expect(matchProviderResourceUrl('https://app.box.com/')).toBeUndefined();
  });
});

describe('canonicalizeResourceUrl across sources', () => {
  it('keys a resource by its provider and id rather than by URL text', () => {
    const notion = canonicalizeResourceUrl(
      'https://www.notion.so/Launch-plan-1f2e3d4c5b6a7988990a1b2c3d4e5f60?pvs=4',
    );
    expect(notion?.provider).toBe('notion');
    expect(notion?.canonicalKey).toBe('notion:1f2e3d4c5b6a7988990a1b2c3d4e5f60');
  });

  it('collapses two spellings of one SharePoint document onto one key', () => {
    const a = canonicalizeResourceUrl(
      'https://contoso.sharepoint.com/:w:/g/personal/ada_contoso_com/EQx7Report?e=abc',
    );
    const b = canonicalizeResourceUrl(
      'https://contoso.sharepoint.com/:w:/g/personal/ada_contoso_com/EQx7Report#page=2',
    );
    expect(a?.canonicalKey).toBe(b?.canonicalKey);
  });

  it('still falls back to a web key for an unrecognized host', () => {
    expect(canonicalizeResourceUrl('https://example.com/a')?.provider).toBe('web');
  });
});
