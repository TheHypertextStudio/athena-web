import { z } from 'zod';
import { readStoredJson, writeStoredJson } from '@docket/ui/lib/browser-storage';
import {
  WorkTemplateGalleryPreviewRequest,
  WorkTemplateGalleryItem,
  WorkTemplateGalleryQuery,
} from '@docket/work/template-gallery-contract';
import type { GalleryAttemptScope } from './gallery-acceptance-attempt';

/** Unsaved catalog choices only; canonical draft definitions always come from the server. */
export const GalleryTabChoices = WorkTemplateGalleryPreviewRequest.extend({
  roots: z.array(WorkTemplateGalleryItem.shape.slug).max(100),
});
/** A selection may be empty until an explicit checked review is requested. */
export type GalleryTabChoices = z.infer<typeof GalleryTabChoices>;
const memory = z.object({
  choices: GalleryTabChoices,
  filters: WorkTemplateGalleryQuery,
  view: z.enum(['suggested', 'all']).default('suggested'),
  returnTo: z
    .object({
      slug: WorkTemplateGalleryItem.shape.slug,
      top: z.number(),
      left: z.number(),
    })
    .optional(),
});
/** Account/workspace-scoped unsaved review memory, never a saved bundle. */
export type GalleryTabMemory = z.infer<typeof memory>;
function key(scope: GalleryAttemptScope): string {
  return `docket:gallery-review:${JSON.stringify([scope.userId, scope.orgId])}`;
}
/** Restore lawful catalog choices after reload, tolerating corrupt or unavailable tab storage. */
export function readGalleryTabMemory(scope: GalleryAttemptScope): GalleryTabMemory {
  const previous = memory.safeParse(readStoredJson(key(scope), 'session'));
  return previous.success
    ? previous.data
    : {
        choices: { roots: [], release: 1, mode: 'private_drafts', labels: [], offerings: [] },
        filters: {},
        view: 'suggested',
      };
}
/** Remember unsaved selection metadata without storing private template documents or server draft claims. */
export function writeGalleryTabMemory(scope: GalleryAttemptScope, value: GalleryTabMemory): void {
  writeStoredJson(key(scope), memory.parse(value), 'session');
}
