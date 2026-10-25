import type {
  CopyReferenceBinding,
  WorkTemplateSourceCopyPreview,
} from '@docket/work/template-copy';

/** Exact checked slot-to-source relation; reservation details remain private to the canonical service. */
export type TemplateCopyReferenceBinding = Pick<CopyReferenceBinding, 'slot' | 'target'>;
/** Common checked presentation: catalog reviews keep their original contract, saved sources carry exact bindings. */
export type TemplateCopyReview = Omit<WorkTemplateSourceCopyPreview, 'copies'> & {
  readonly copies: (Omit<WorkTemplateSourceCopyPreview['copies'][number], 'referenceBindings'> & {
    readonly referenceBindings?: readonly TemplateCopyReferenceBinding[];
  })[];
};
