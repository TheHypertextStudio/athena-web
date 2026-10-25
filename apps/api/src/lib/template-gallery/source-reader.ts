import { OrganizationId } from '@docket/identity-access/ids';
import { GALLERY_CATALOG } from '@docket/work/template-gallery';
import {
  authoredCopyReferences,
  catalogCopySource,
  copyIdentityKey,
  type CopyDefinitionSource,
  type CopyReferenceBinding,
  type TemplateCopySourcesInput,
  type WorkTemplateCopySourceSelection,
} from '@docket/work/template-copy';
import { ConflictError, NotFoundError } from '../../error';
import type { TemplateTransaction } from '../templates/persistence';
import { requireGalleryEntry } from './catalog';
import { readTenantCopySource, type TenantCopySource } from './tenant-source';

/** One request's authorized closure; exact latest decisions are frozen once and never taken from caller snapshots. */
class SourceReader {
  private readonly sources = new Map<string, CopyDefinitionSource>();
  private readonly selections = new Map<string, Promise<TenantCopySource>>();
  private readonly bindings: CopyReferenceBinding[] = [];
  constructor(
    private readonly tx: TemplateTransaction,
    private readonly userId: string,
  ) {}

  private read(
    selection: WorkTemplateCopySourceSelection,
    allowReservedDraft = false,
  ): Promise<TenantCopySource> {
    const mayResolveDraft =
      allowReservedDraft &&
      selection.kind === 'publication' &&
      selection.selection.kind === 'pinned';
    const key = JSON.stringify([selection, mayResolveDraft]);
    const known = this.selections.get(key);
    if (known) return known;
    const pending =
      selection.kind === 'catalog'
        ? catalogCopySource(requireGalleryEntry(selection.slug)).then((source) => ({ source }))
        : readTenantCopySource(this.tx, this.userId, selection, allowReservedDraft);
    this.selections.set(key, pending);
    return pending;
  }
  private dependency(
    owner: CopyDefinitionSource,
    reference: ReturnType<typeof authoredCopyReferences>[number],
  ): Promise<TenantCopySource> {
    const pin = reference.reference;
    if (owner.identity.kind !== 'catalog')
      return this.read(
        {
          kind: 'publication',
          organizationId: owner.identity.organizationId,
          workTypeId: pin.workTypeId,
          selection: pin.selection,
        },
        owner.identity.kind === 'draft',
      );
    const entry = GALLERY_CATALOG.find(
      (candidate) =>
        candidate.id === pin.workTypeId &&
        pin.selection.kind === 'pinned' &&
        candidate.versionId === pin.selection.workTypeVersionId,
    );
    if (!entry) throw new NotFoundError('Template not found');
    return this.read({ kind: 'catalog', slug: entry.slug, release: 1 });
  }
  private async visit(loaded: TenantCopySource): Promise<void> {
    const source = loaded.source,
      key = copyIdentityKey(source.identity);
    if (this.sources.has(key)) return;
    if (this.sources.size >= 100) throw new ConflictError('Choose at most 100 work definitions.');
    this.sources.set(key, source);
    for (const reference of authoredCopyReferences(source)) {
      if (this.bindings.length >= 2000)
        throw new ConflictError('This selection includes too many connections.');
      const target = await this.dependency(source, reference);
      this.bindings.push({
        source: source.identity,
        slot: reference.slot,
        target: target.source.identity,
        ...(target.reservation ? { reservation: target.reservation } : {}),
      });
      await this.visit(target);
    }
  }
  /** Read every selected root and included definition under independent current source authorization. */
  async load(
    organizationId: string,
    selections: readonly WorkTemplateCopySourceSelection[],
  ): Promise<TemplateCopySourcesInput> {
    const roots = [];
    for (const selection of selections) {
      const loaded = await this.read(selection);
      roots.push(loaded.source.identity);
      await this.visit(loaded);
    }
    return {
      destinationOrganizationId: OrganizationId.parse(organizationId),
      roots,
      sources: [...this.sources.values()],
      bindings: this.bindings,
    };
  }
}
/** Freeze a bounded exact source graph; this performs reads only and allocates no destination identities. */
export function loadTemplateCopySources(
  tx: TemplateTransaction,
  userId: string,
  organizationId: string,
  selections: readonly WorkTemplateCopySourceSelection[],
): Promise<TemplateCopySourcesInput> {
  return new SourceReader(tx, userId).load(organizationId, selections);
}
