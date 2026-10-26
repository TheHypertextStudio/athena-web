'use client';

import type { TemplateTargetType } from '@docket/work/template-contract';
import type { JSX } from 'react';
import { useApiQuery } from '@/lib/query';
import { workTemplateIdentityDef } from './work-template-identity-queries';

/** Quiet current type identity, independent of the work's editable title and definition revision. */
export function WorkTypeLabel({
  orgId,
  workTypeId,
  workTypeVersionId,
}: {
  readonly orgId: string;
  readonly kind: TemplateTargetType;
  readonly workTypeId: string | undefined;
  readonly workTypeVersionId: string | undefined;
}): JSX.Element | null {
  const identity = useApiQuery(workTemplateIdentityDef(orgId, workTypeId, workTypeVersionId));
  if (!identity.data || identity.data.isBase) return null;
  return <span data-work-type-name="">{identity.data.name}</span>;
}
