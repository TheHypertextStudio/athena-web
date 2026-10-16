import { beforeAll, describe, expect, it } from 'vitest';
import { GALLERY_CATALOG } from '../src/gallery/catalog';
import { galleryOutline, galleryContainer } from '../src/gallery/builders';
import { catalogCopySource, catalogCopyBindings } from '../src/gallery/copy-catalog-adapter';
import { ProspectiveCopyCatalog } from '../src/gallery/copy-prospective-source';
import { validateProspectiveCopyExpansion } from '../src/gallery/copy-prospective-closure';
import type { CopyDefinitionSource } from '../src/gallery/copy-prospective-types';
import { targetOrganizationId } from './gallery-prospective-fixture';
let sources: CopyDefinitionSource[];
beforeAll(async () => {
  sources = await Promise.all(GALLERY_CATALOG.map(catalogCopySource));
});
function expand(source: CopyDefinitionSource, facts = sources) {
  const input = {
    destinationOrganizationId: targetOrganizationId,
    roots: [source.identity],
    sources: facts,
    bindings: catalogCopyBindings(facts),
  };
  return validateProspectiveCopyExpansion(new ProspectiveCopyCatalog(input), source);
}
function catalogSource(slug: string): CopyDefinitionSource {
  const entry = GALLERY_CATALOG.find((item) => item.slug === slug);
  const source = sources.find((item) => item.identity.workTypeId === entry?.id);
  if (!source) throw new Error('Missing released outline');
  return source;
}
describe('authored gallery outline order in actual structural expansion', () => {
  it('keeps Event preparation in authored sequence with Vendor booking expanded in place', () => {
    const graph = expand(catalogSource('event'));
    expect(
      graph.nodes
        .filter((node) => node.parentPath?.length === 0)
        .map((node) => node.path.join('/')),
    ).toEqual(['book_venue', 'promote', 'headcount', 'run', 'thank_you']);
    const paths = graph.nodes.map((node) => node.path.join('/'));
    expect(paths.indexOf('book_venue')).toBeLessThan(paths.indexOf('book_venue/get_quote'));
    expect(paths.indexOf('book_venue/get_quote')).toBeLessThan(paths.indexOf('promote'));
  });
  it('preserves Fundraising event and Donor outreach nested sequences', () => {
    const graph = expand(catalogSource('fundraising-campaign'));
    expect(
      graph.nodes
        .filter((node) => node.parentPath?.length === 0)
        .map((node) => node.path.join('/')),
    ).toEqual(['event', 'outreach']);
    expect(
      graph.nodes
        .filter((node) => node.parentPath?.join('/') === 'event')
        .map((node) => node.path.join('/')),
    ).toEqual([
      'event/venue',
      'event/sponsors',
      'event/marketing',
      'event/registrations',
      'event/thanks',
    ]);
    expect(
      graph.nodes
        .filter((node) => node.parentPath?.join('/') === 'outreach')
        .map((node) => node.path.join('/')),
    ).toEqual(['outreach/segment', 'outreach/appeal', 'outreach/send', 'outreach/thank_record']);
  });
  it('retains the Partnership readiness checkpoint and its authored parent relation', () => {
    const graph = expand(catalogSource('partnership-event'));
    expect(graph.nodes.map((node) => node.path.join('/'))).toEqual([
      '',
      'ready_to_host',
      'partner_guidance',
    ]);
    expect(
      graph.nodes.find((node) => node.sourceStepKey === 'partner_guidance')?.parentPath,
    ).toEqual(['ready_to_host']);
  });
  it('orders combined actions and provided steps by the authored array without key sorting', async () => {
    const entry = galleryOutline({
      slug: 'event',
      purpose: 'Check authored sequence',
      actions: [
        ['first', 'First', 'Do first'],
        ['second', 'Second', 'Do second'],
      ],
      steps: [
        galleryContainer({
          key: 'a_third',
          kind: 'task',
          name: 'Third',
          purpose: 'Finish third',
          checklist: 'Do third',
        }),
      ],
    });
    const source = await catalogCopySource(entry);
    expect(expand(source, [source]).nodes.map((node) => node.path.join('/'))).toEqual([
      '',
      'first',
      'second',
      'a_third',
    ]);
  });
});
