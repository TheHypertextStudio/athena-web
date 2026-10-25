import { z } from 'zod';
import { OrganizationId } from '@docket/identity-access/ids';
import { WorkTemplateCopySourceSelection } from '@docket/work/template-copy';
import type { WorkTemplateOut, WorkTemplateVersionOut } from '@docket/work/work-template-contract';
import { readStoredJson, writeStoredJson } from '@docket/ui/lib/browser-storage';
import { UserFacingError } from '@/lib/problem';

/** Same authenticated person and actual session, never a restored browser identity grant. */
export interface SourceCopyOwner {
  readonly userId: string;
  readonly sessionId: string;
}
const metadata = z.strictObject({
  id: z.uuid(),
  source: WorkTemplateCopySourceSelection.refine((source) => source.kind !== 'catalog'),
  destinationOrgId: OrganizationId.nullable().default(null),
  submitted: z.boolean().default(false),
  phase: z.enum(['choices', 'review']).default('choices'),
  mode: z.enum(['private_drafts', 'published']).default('private_drafts'),
});
/** Lawful unsaved copy choices; no template definition, labels or member data enter tab storage. */
export type SourceCopyMemory = z.infer<typeof metadata>;
function key(owner: SourceCopyOwner, id: string): string {
  return `docket:source-copy:${JSON.stringify([owner.userId, owner.sessionId, id])}`;
}
/** Restore only validated metadata from this account/session and opaque route identity. */
export function readSourceCopy(owner: SourceCopyOwner, id: string): SourceCopyMemory | null {
  if (!z.uuid().safeParse(id).success) return null;
  const parsed = metadata.safeParse(readStoredJson(key(owner, id), 'session'));
  return parsed.success && parsed.data.id === id ? parsed.data : null;
}
/** Remember explicit choices, verifying storage before any possible acceptance. */
export function writeSourceCopy(owner: SourceCopyOwner, value: SourceCopyMemory): void {
  const checked = metadata.parse(value);
  writeStoredJson(key(owner, checked.id), checked, 'session');
  if (JSON.stringify(readSourceCopy(owner, checked.id)) !== JSON.stringify(checked))
    throw new UserFacingError(
      'This tab could not remember your copy choices. Allow site storage and try again.',
    );
}
/** Begin a focused saved-source copy without copying unsaved editor contents. */
export function createSourceCopy(
  owner: SourceCopyOwner,
  source: WorkTemplateCopySourceSelection,
): SourceCopyMemory {
  const value = metadata.parse({ id: crypto.randomUUID(), source });
  writeSourceCopy(owner, value);
  return value;
}
/** A truthful saved-source choice, separate from the mutable editor contents. */
export interface SourceCopyChoice {
  readonly label: string;
  readonly name: string;
  readonly source: SourceCopyMemory['source'];
}
/** Offer a saved draft only with body/edit access; publication-only readers receive exact snapshots. */
export function sourceCopyChoices(
  template: WorkTemplateOut,
  history?: readonly WorkTemplateVersionOut[],
): readonly SourceCopyChoice[] {
  if (template.isBase || template.status === 'archived') return [];
  const draft: SourceCopyChoice[] = hasSavedDraftBody(template)
    ? [
        {
          label: 'Saved draft',
          name: template.draftDefinition?.name ?? template.definition.name,
          source: {
            kind: 'draft',
            organizationId: template.organizationId,
            workTypeId: template.id,
          },
        },
      ]
    : [];
  const versions = history ?? (template.latestVersion ? [template.latestVersion] : []);
  const publications = versions.map((version): SourceCopyChoice => ({
    label: `Published version ${version.number}`,
    name: version.definition.name,
    source: {
      kind: 'publication',
      organizationId: template.organizationId,
      workTypeId: template.id,
      selection: { kind: 'pinned', workTypeVersionId: version.id },
    },
  }));
  return template.canEdit ? [...draft, ...publications] : [...publications, ...draft];
}

function hasSavedDraftBody(template: WorkTemplateOut): boolean {
  return template.canEdit || template.status === 'draft' || template.draftDefinition !== undefined;
}
