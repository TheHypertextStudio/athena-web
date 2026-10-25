import { z } from 'zod';
import {
  WorkTemplateSourceCopyAcceptRequest,
  WorkTemplateSourceCopyPreview,
  WorkTemplateSourceCopyPreviewRequest,
} from '@docket/work/template-copy';
import {
  WorkTemplateCopyReceipt,
  WorkTemplateGalleryDetail,
  WorkTemplateGalleryFork,
  WorkTemplateGalleryForkSet,
  WorkTemplateGalleryItem,
  WorkTemplateGalleryQuery,
} from '@docket/work/template-gallery-contract';
import { pageOf } from '../contracts/pagination';
import { orgIdParam } from './tools-shared';

/** Bounded released starting-work discovery; a full fork deliberately returns its complete root membership. */
export const browseWorkTemplatesDefinition = {
  title: 'Browse starting work',
  description:
    'Browse curated work definitions, inspect an outline, or get a complete startup, nonprofit, agency or personal set. Nothing is installed.',
  inputSchema: {
    orgId: orgIdParam,
    query: z.discriminatedUnion('action', [
      WorkTemplateGalleryQuery.extend({
        action: z.literal('browse'),
        limit: z.number().int().min(1).max(50).default(20),
        cursor: z.string().optional(),
      }).strict(),
      z.strictObject({ action: z.literal('detail'), slug: z.string().min(1).max(100) }),
      z.strictObject({ action: z.literal('fork'), fork: WorkTemplateGalleryFork }),
    ]),
  },
  outputSchema: {
    data: z.union([
      pageOf(WorkTemplateGalleryItem),
      WorkTemplateGalleryDetail,
      WorkTemplateGalleryForkSet,
    ]),
  },
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
};
/** Manual reviewed copy adapter; the same canonical REST writer owns identity, privacy, retries and Undo. */
export const copyWorkTemplatesDefinition = {
  title: 'Copy reviewed work definitions',
  description:
    'Preview authorized workspace or catalog definitions in the destination, then keep that exact review as independent private drafts or explicitly publish. Reconcile interrupted outcomes by requestId. Automatic Athena writes use Inbox review instead.',
  inputSchema: {
    orgId: orgIdParam,
    query: z.discriminatedUnion('action', [
      WorkTemplateSourceCopyPreviewRequest.extend({ action: z.literal('preview') }),
      WorkTemplateSourceCopyAcceptRequest.extend({ action: z.literal('keep') }),
      z.strictObject({ action: z.literal('reconcile'), requestId: z.uuid() }),
    ]),
  },
  outputSchema: { data: z.union([WorkTemplateSourceCopyPreview, WorkTemplateCopyReceipt]) },
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
};
