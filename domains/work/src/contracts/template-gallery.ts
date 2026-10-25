import { z } from 'zod';
import { LabelId, WorkTypeId, WorkTypeVersionId } from '../ids';
import { TeamId } from '@docket/identity-access/ids';
import { GalleryCategory, GalleryFork } from '../gallery/types';
import { CopySourceIdentity } from '../gallery/copy-identity';
import { WorkTemplateDefinition, WorkTemplateOut } from './work-template';
import { TemplateTargetType } from './template';

const slug = z
  .string()
  .regex(/^[a-z][a-z0-9-]*$/)
  .max(100);
/** Fixed released-catalog discovery filters; pagination is supplied by the existing API contract. */
export const WorkTemplateGalleryQuery = z.object({
  search: z.string().trim().max(120).optional(),
  category: GalleryCategory.optional(),
  fork: GalleryFork.optional(),
  targetType: TemplateTargetType.optional(),
});
/** Validated released-catalog discovery filters. */
export type WorkTemplateGalleryQuery = z.infer<typeof WorkTemplateGalleryQuery>;
/** Public catalog identity in its actual release namespace, never a workspace publication. */
export const WorkTemplateGalleryIdentity = CopySourceIdentity.options[2];
/** Small browse result with concrete intended use and work kind. */
export const WorkTemplateGalleryItem = z.strictObject({
  identity: WorkTemplateGalleryIdentity,
  slug,
  name: z.string().min(1),
  targetType: TemplateTargetType,
  category: GalleryCategory,
  forks: z.array(GalleryFork),
  use: z.string().min(1).max(300),
});
/** Small released-catalog browse result. */
export type WorkTemplateGalleryItem = z.infer<typeof WorkTemplateGalleryItem>;
/** Approved full-fork choice, independent of organization creation intent or vocabulary. */
export const WorkTemplateGalleryFork = GalleryFork;
/** Complete root set for an explicit full-fork selection, never just the first browse page. */
export const WorkTemplateGalleryForkSet = z.strictObject({
  fork: GalleryFork,
  release: z.literal(1),
  items: z.array(WorkTemplateGalleryItem).max(100),
});
/** Complete released roots for one approved full-fork selection. */
export type WorkTemplateGalleryForkSet = z.infer<typeof WorkTemplateGalleryForkSet>;
/** Complete root definition; referenced reusable work is resolved within the same catalog release. */
export const WorkTemplateGallerySource = WorkTemplateGalleryItem.extend({
  definition: WorkTemplateDefinition,
  labelSuggestions: z.array(z.string().min(1)).max(10),
  offeringSuggestions: z.array(z.string().min(1)).max(10),
});
/** Root and exact referenced source definitions for an honest nested catalog outline. */
export const WorkTemplateGalleryDetail = WorkTemplateGallerySource.extend({
  references: z.array(WorkTemplateGallerySource).max(99),
});
/** Authorized complete released-catalog detail. */
export type WorkTemplateGalleryDetail = z.infer<typeof WorkTemplateGalleryDetail>;
/** Explicit reviewed destination visibility; keeping drafts never publishes their dependencies. */
export const WorkTemplateCopyMode = z.enum(['private_drafts', 'published']);
/** Read-only gallery preview choices; actual labels/teams are verified in the destination workspace. */
export const WorkTemplateGalleryPreviewRequest = z.strictObject({
  roots: z
    .array(slug)
    .min(1)
    .max(100)
    .refine((values) => new Set(values).size === values.length),
  release: z.literal(1),
  mode: WorkTemplateCopyMode,
  labels: z
    .array(
      z.strictObject({
        sourceSlug: slug,
        suggestion: z.string().min(1).max(100),
        destinationLabelId: LabelId,
      }),
    )
    .max(100)
    .default([]),
  offerings: z
    .array(z.strictObject({ sourceSlug: slug, teamIds: z.array(TeamId).max(100) }))
    .max(100)
    .default([]),
});
/** Validated manual gallery review choices, without caller-supplied authority or destination IDs. */
export type WorkTemplateGalleryPreviewRequest = z.infer<typeof WorkTemplateGalleryPreviewRequest>;
/** A transitive definition that will be copied independently if this preview is accepted. */
export const WorkTemplateGalleryPreviewCopy = z.strictObject({
  source: WorkTemplateGalleryIdentity,
  name: z.string().min(1),
  targetType: TemplateTargetType,
  definition: WorkTemplateDefinition,
  offeredTeamIds: z.array(TeamId).max(100),
  dependencies: z.array(WorkTemplateGalleryIdentity).max(100),
});
/** Complete manual preview; the fingerprint detects stale choices and grants no write authority. */
export const WorkTemplateGalleryPreview = z.strictObject({
  reviewFingerprint: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  mode: WorkTemplateCopyMode,
  roots: z.array(WorkTemplateGalleryIdentity).min(1).max(100),
  copies: z.array(WorkTemplateGalleryPreviewCopy).min(1).max(100),
  omissions: z.array(
    z.strictObject({
      source: WorkTemplateGalleryIdentity,
      kind: z.enum(['label', 'image', 'offering', 'label_suggestion', 'offering_suggestion']),
      path: z.array(z.union([z.string(), z.number().int().nonnegative()])),
      count: z.number().int().nonnegative(),
      value: z.string().optional(),
    }),
  ),
});
/** Reviewed catalog closure and concrete omissions before any identity allocation or write. */
export type WorkTemplateGalleryPreview = z.infer<typeof WorkTemplateGalleryPreview>;

/** Accept only the exact reviewed choices under a stable retry identity; it grants no source authority. */
export const WorkTemplateGalleryAcceptRequest = WorkTemplateGalleryPreviewRequest.extend({
  requestId: z.uuid(),
  expectedReviewFingerprint: z.string().regex(/^sha256:[a-f0-9]{64}$/),
});
/** Explicit manual acceptance; repeats use the same request ID and reviewed choices. */
export type WorkTemplateGalleryAcceptRequest = z.infer<typeof WorkTemplateGalleryAcceptRequest>;
/** Canonical copy outcome, including actual publications only when publication was explicitly accepted. */
export const WorkTemplateCopyReceipt = z
  .strictObject({
    bundleId: z.ulid(),
    changeSetId: z.ulid(),
    mode: WorkTemplateCopyMode,
    state: z.enum(['installed', 'undone']),
    roots: z
      .array(
        z.strictObject({
          workTypeId: WorkTypeId,
          workTypeVersionId: WorkTypeVersionId.nullable(),
          targetType: TemplateTargetType,
        }),
      )
      .min(1)
      .max(100),
  })
  .superRefine((receipt, ctx) => {
    if (new Set(receipt.roots.map((root) => root.workTypeId)).size !== receipt.roots.length)
      ctx.addIssue({ code: 'custom', path: ['roots'], message: 'Return each copied root once.' });
    if (
      receipt.roots.some(
        (root) => (root.workTypeVersionId !== null) !== (receipt.mode === 'published'),
      )
    )
      ctx.addIssue({
        code: 'custom',
        path: ['roots'],
        message: 'Return only explicitly accepted publications.',
      });
  });
/** Saved copy result; private draft IDs are real but do not claim a publication exists. */
export type WorkTemplateCopyReceipt = z.infer<typeof WorkTemplateCopyReceipt>;

/** Durable authorized reentry uses current canonical drafts; reservation identity is explicitly unpublished. */
export const WorkTemplateCopyBundle = z.strictObject({
  receipt: WorkTemplateCopyReceipt,
  entries: z
    .array(
      z.strictObject({
        key: z.string().min(1).max(128),
        isRoot: z.boolean(),
        workTypeId: WorkTypeId,
        template: WorkTemplateOut.nullable(),
        catalogOrigin: WorkTemplateGalleryIdentity.nullable(),
        dependencies: z.array(WorkTypeId).max(99),
        reservation: z.strictObject({
          state: z.enum(['pending', 'consumed', 'void']),
          reservedFirstPublicationId: WorkTypeVersionId,
        }),
      }),
    )
    .min(1)
    .max(100),
});
/** Acceptor-private bundle with currently authorized definitions and safe catalog provenance only. */
export type WorkTemplateCopyBundle = z.infer<typeof WorkTemplateCopyBundle>;

/** Actual aggregate reversal outcome; retained IDs identify only the acceptor's own installed copies. */
export const WorkTemplateCopyUndoResult = z.strictObject({
  receipt: WorkTemplateCopyReceipt.refine((receipt) => receipt.state === 'undone'),
  retained: z
    .array(
      z.strictObject({
        workTypeId: WorkTypeId,
        reason: z.enum(['changed_since', 'in_use']),
      }),
    )
    .max(100),
});
/** Terminal copy Undo with safe reasons and no identities/counts of hidden protecting work. */
export type WorkTemplateCopyUndoResult = z.infer<typeof WorkTemplateCopyUndoResult>;

/** Explicit saved context for an optional Athena starting-work request. */
export const TemplateTailoringSelection = z.strictObject({
  fork: GalleryFork,
  sessionIds: z.array(z.ulid()).max(5),
  importedTaskIds: z.array(z.ulid()).max(30),
});
/** Selected saved records, never caller-supplied source bodies. */
export type TemplateTailoringSelection = z.infer<typeof TemplateTailoringSelection>;
/** Exact context checkpoint accepted by the person before generation. */
export const TemplateTailoringRequest = TemplateTailoringSelection.extend({
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
});
/** Exact checkpointed tailoring request. */
export type TemplateTailoringRequest = z.infer<typeof TemplateTailoringRequest>;
/** Current readable sources and capability availability; no private context bodies. */
export const TemplateTailoringSources = z.strictObject({
  availability: z.enum(['available', 'requires_pro', 'authoring_unavailable']),
  conversations: z.array(z.strictObject({ id: z.string(), label: z.string() })),
  importedWork: z.array(z.strictObject({ id: z.string(), label: z.string() })),
});
/** Server-checked source checkpoint, without duplicating retained context. */
export const TemplateTailoringPreview = z.strictObject({
  fingerprint: z.string(),
  conversationCount: z.number().int().nonnegative(),
  importedWorkCount: z.number().int().nonnegative(),
});
/** Actual persisted request status and safe links to resulting Inbox proposals. */
export const TemplateTailoringStatus = z.strictObject({
  sessionId: z.string(),
  status: z.string(),
  proposalIds: z.array(z.string()),
});

/** Explicit examples for one stand-in label; source bodies and authority are server-owned. */
export const LabelTemplateSuggestionSelection = z.strictObject({
  labelGroupId: z.ulid(),
  labelId: LabelId,
  kind: TemplateTargetType,
  workIds: z
    .array(z.ulid())
    .min(1)
    .max(100)
    .refine((ids) => new Set(ids).size === ids.length, 'Choose each example once.'),
});
/** Selected saved label usage, without inferred or background work selection. */
export type LabelTemplateSuggestionSelection = z.infer<typeof LabelTemplateSuggestionSelection>;
/** Current checked examples accepted before a private review-only suggestion. */
export const LabelTemplateSuggestionRequest = LabelTemplateSuggestionSelection.extend({
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
});
/** Exact reviewed label usage request. */
export type LabelTemplateSuggestionRequest = z.infer<typeof LabelTemplateSuggestionRequest>;
/** Only authorized example names appear in the context review. */
export const LabelTemplateSuggestionPreview = z.strictObject({
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  labelGroup: z.strictObject({ id: z.ulid(), name: z.string() }),
  label: z.strictObject({ id: LabelId, name: z.string() }),
  work: z
    .array(z.strictObject({ id: z.ulid(), kind: TemplateTargetType, name: z.string() }))
    .min(1)
    .max(100),
});
/** Server-checked selected examples and their source checkpoint. */
export type LabelTemplateSuggestionPreview = z.infer<typeof LabelTemplateSuggestionPreview>;
/** Only current authorized group/label metadata is offered for explicit example selection. */
export const LabelTemplateSuggestionSources = z.strictObject({
  availability: z.enum(['available', 'requires_pro', 'authoring_unavailable']),
  groups: z.array(z.strictObject({ id: z.ulid(), name: z.string() })),
  labels: z.array(z.strictObject({ id: LabelId, groupId: z.ulid(), name: z.string() })),
});
/** Source picker metadata without aggregate usage counts or hidden team vocabulary. */
export type LabelTemplateSuggestionSources = z.infer<typeof LabelTemplateSuggestionSources>;
