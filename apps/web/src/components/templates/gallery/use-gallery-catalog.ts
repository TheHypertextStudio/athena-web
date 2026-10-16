'use client';
import { WorkTemplateGalleryItem } from '@docket/work/template-gallery-contract';
import { z } from 'zod';
import { useApiQuery } from '@/lib/query';
import type { QueryFailureSource } from '@/components/feedback/query-load-failure';
import { templateGalleryAllDef } from '../work-template-gallery-queries';
const metadata = z.object({ items: WorkTemplateGalleryItem.array() });
/** Current catalog metadata is loaded only for browse/review, independently from saved bundle recovery. */
export interface GalleryCatalogState {
  readonly items: readonly WorkTemplateGalleryItem[];
  readonly pending: boolean;
  readonly failed: boolean;
  readonly failure: QueryFailureSource;
}
/** Read complete actual catalog metadata without making retained copy outcomes depend on source discovery. */
export function useGalleryCatalog(orgId: string, enabled = true): GalleryCatalogState {
  const query = useApiQuery({ ...templateGalleryAllDef(orgId), enabled });
  const parsed = metadata.safeParse(query.data);
  return {
    items: parsed.success ? parsed.data.items : [],
    pending: enabled && query.isPending,
    failed: enabled && (query.isError || (query.isSuccess && !parsed.success)),
    failure: query,
  };
}
