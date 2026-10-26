'use client';

import type { TemplateTargetType } from '@docket/work/template-contract';
import { useVocabulary } from '@docket/ui/hooks';
import type { JSX } from 'react';
import { useApiQuery } from '@/lib/query';
import { workTemplateIdentityDef } from './work-template-identity-queries';
import { workTypeDisplayName } from './work-type-name';

/** Quiet current type identity, independent of the work's editable title and definition revision. */
export function WorkTypeLabel({
  orgId,
  kind,
  workTypeId,
  workTypeVersionId,
}: {
  readonly orgId: string;
  readonly kind: TemplateTargetType;
  readonly workTypeId: string | undefined;
  readonly workTypeVersionId: string | undefined;
}): JSX.Element {
  const familyName = useVocabulary(kind);
  const identity = useApiQuery(workTemplateIdentityDef(orgId, workTypeId, workTypeVersionId));
  return <span>{identity.data ? workTypeDisplayName(identity.data, familyName) : familyName}</span>;
}
