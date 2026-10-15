import { getDocumentImageReferenceReconciler } from '../../content/document-image-reference-registry';

/** Reconcile a template projection without turning a derived-state failure into a lost edit. */
export async function reconcileTemplateImages(
  organizationId: string,
  templateId: string,
  operation: 'upsert' | 'delete',
): Promise<void> {
  try {
    const reconciler = getDocumentImageReferenceReconciler();
    if (operation === 'delete') {
      await reconciler.deleteForSubject(organizationId, 'template', templateId);
    } else {
      await reconciler.reconcile(organizationId, 'template', templateId);
    }
  } catch (error) {
    console.warn('Template document-image reconciliation failed', {
      organizationId,
      templateId,
      operation,
      error,
    });
  }
}
