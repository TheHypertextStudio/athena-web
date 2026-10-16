import { describe, expect, it } from 'vitest';
import { GALLERY_CATALOG } from '../src/gallery/catalog';
import { catalogCopySource, catalogCopyBindings } from '../src/gallery/copy-catalog-adapter';
import {
  previewTemplateCopySources,
  planTemplateCopySources,
} from '../src/gallery/copy-prospective-plan';
import { prospectiveDestination, targetOrganizationId } from './gallery-prospective-fixture';
import { copyIdentityKey } from '../src/gallery/copy-identity';
describe('released catalog planning without fabricated publication facts', () => {
  it('validates all110 catalog roots using honest release identities and no workspace/base projections', async () => {
    const sources = await Promise.all(GALLERY_CATALOG.map(catalogCopySource));
    const bindings = catalogCopyBindings(sources);
    for (const source of sources) {
      expect(source.identity.kind).toBe('catalog');
      expect(source).not.toHaveProperty('snapshot');
      expect(source.identity).not.toHaveProperty('organizationId');
      expect(source).not.toHaveProperty('stepIds');
      const preview = await previewTemplateCopySources({
        destinationOrganizationId: targetOrganizationId,
        roots: [source.identity],
        sources,
        bindings,
      });
      expect(preview.copies.length).toBeGreaterThan(0);
      expect(preview.copies.at(-1)?.source).toEqual(source.identity);
    }
  });
  it('copies independent Program schedule definitions with exact destination reservation pins', async () => {
    const sources = await Promise.all(GALLERY_CATALOG.map(catalogCopySource));
    const root = sources.find((source) => source.definition.name === 'Content calendar');
    if (!root) throw new Error('Missing Content calendar');
    const input = {
      destinationOrganizationId: targetOrganizationId,
      roots: [root.identity],
      sources,
      bindings: catalogCopyBindings(sources),
    };
    const preview = await previewTemplateCopySources(input);
    const selected = preview.copies.map((unit) => {
      const source = sources.find(
        (item) => copyIdentityKey(item.identity) === copyIdentityKey(unit.source),
      );
      if (!source) throw new Error('Missing selected catalog source');
      return source;
    });
    const destinations = selected.map((source, index) =>
      prospectiveDestination(source, 10000 + index * 1000),
    );
    const plan = await planTemplateCopySources({ ...input, destinations });
    const copied = plan.copies.at(-1);
    expect(copied?.definition.defaultSchedules).toHaveLength(2);
    const pairs = new Set(
      plan.copies.map((copy) => `${copy.workTypeId}:${copy.reservedFirstPublicationId}`),
    );
    for (const schedule of copied?.definition.defaultSchedules ?? []) {
      expect(schedule.template.selection.kind).toBe('pinned');
      if (schedule.template.selection.kind !== 'pinned') throw new Error('Unfrozen schedule copy');
      expect(
        pairs.has(
          `${schedule.template.workTypeId}:${schedule.template.selection.workTypeVersionId}`,
        ),
      ).toBe(true);
    }
  });
});
