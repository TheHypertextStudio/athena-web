/** The process-wide document-image reference reconciler used outside entity-write subscribers. */
import { createDrizzleDocumentImageReferenceStorage } from './drizzle-document-image-reference-storage';
import {
  createDocumentImageReferenceReconciler,
  type DocumentImageReferenceReconciler,
} from './document-image-references';

let reconciler: DocumentImageReferenceReconciler | undefined;

/** Return the memoized reconciler for template writes, deletion checks, and cleanup. */
export function getDocumentImageReferenceReconciler(): DocumentImageReferenceReconciler {
  reconciler ??= createDocumentImageReferenceReconciler(
    createDrizzleDocumentImageReferenceStorage(),
  );
  return reconciler;
}

/** Replace the process-wide reconciler for a focused test. */
export function setDocumentImageReferenceReconciler(
  replacement: DocumentImageReferenceReconciler | undefined,
): void {
  reconciler = replacement;
}
