'use client';
import type { JSX } from 'react';
import type { WorkTemplateDefinition, WorkTemplateOut } from '@docket/work/work-template-contract';
import { authoredCopyReferences } from '@docket/work/template-copy';
import { Button } from '@docket/ui/primitives';
import Link from '@/components/docket-link';
import { useApiQuery } from '@/lib/query';
import { workTemplatesDef } from './work-template-queries';
import { pendingTemplateReference } from './work-template-pending-reference';
import { workTemplateHref } from './work-template-navigation';

/** Current checked first-publication prerequisites; historical pins are never inferred pending. */
export function pendingDefinitionPrerequisites(
  definition: WorkTemplateDefinition,
  orgId: string,
  items: readonly WorkTemplateOut[],
): readonly WorkTemplateOut[] {
  const pending = new Map<string, WorkTemplateOut>();
  for (const reference of authoredCopyReferences({ definition })) {
    const target = items.find(
      (item) =>
        item.organizationId === orgId &&
        item.id === reference.reference.workTypeId &&
        item.targetType === reference.kind,
    );
    const match = pendingTemplateReference(reference.reference, target);
    if (match) pending.set(match.id, match);
  }
  return [...pending.values()];
}
/** Read actual authorized draft reservations without asserting a missing or older pin is a publication. */
export function useTemplatePublicationReadiness(
  orgId: string,
  definition: WorkTemplateDefinition,
): TemplatePublicationReadinessState {
  const referenced = authoredCopyReferences({ definition }).length > 0;
  const query = useApiQuery({
    ...workTemplatesDef(orgId, { includeDrafts: true }),
    enabled: referenced,
  });
  const pending = pendingDefinitionPrerequisites(definition, orgId, query.data?.items ?? []);
  return {
    pending,
    loading: referenced && query.isPending,
    failed: referenced && query.isError,
    retry: () => query.refetch(),
  };
}
/** Checked client guidance; the publication command remains the authority for accepting a definition. */
export interface TemplatePublicationReadinessState {
  readonly pending: readonly WorkTemplateOut[];
  readonly loading: boolean;
  readonly failed: boolean;
  readonly retry: () => Promise<unknown>;
}
/** Keep known prerequisite work next to the explicit publication decision, ahead of long documents. */
export function TemplatePublicationReadiness({
  orgId,
  name,
  parentId,
  readiness,
}: {
  readonly orgId: string;
  readonly name: string;
  readonly parentId?: string | undefined;
  readonly readiness: ReturnType<typeof useTemplatePublicationReadiness>;
}): JSX.Element | null {
  if (readiness.loading)
    return (
      <p role="status" className="text-body-small">
        Checking linked definitions…
      </p>
    );
  if (readiness.failed)
    return (
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-body-medium">Linked definitions could not be checked.</p>
        <Button
          variant="secondary"
          onClick={() => {
            void readiness.retry();
          }}
        >
          Try again
        </Button>
      </div>
    );
  if (!readiness.pending.length) return null;
  return (
    <section aria-label="Before publishing" className="flex min-w-0 flex-col gap-2">
      {readiness.pending.map((item) => (
        <div key={item.id} className="flex min-w-0 flex-wrap items-center justify-between gap-2">
          <p className="text-body-medium">
            Publish {item.draftDefinition?.name ?? item.definition.name} before {name}.
          </p>
          <Button
            asChild
            variant="secondary"
            className="coarse:h-auto h-auto min-h-10 max-w-full py-2 whitespace-normal"
          >
            <Link
              href={`${workTemplateHref(orgId)}/${item.id}?section=review${parentId ? `&returnTo=${parentId}` : ''}`}
            >
              Review {item.draftDefinition?.name ?? item.definition.name}
            </Link>
          </Button>
        </div>
      ))}
    </section>
  );
}
