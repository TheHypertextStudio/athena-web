'use client';
import type { JSX } from 'react';
import { Button } from '@docket/ui/primitives';
import Link from '@/components/docket-link';
import { sectionHref } from '@/components/settings/settings-registry';

/** Start the same revisitable full-page work-definition flow used for later refinement. */
export function WorkTemplateGuidedCreate({ orgId }: { orgId: string }): JSX.Element {
  return (
    <Button asChild>
      <Link href={`${sectionHref(orgId, 'templates')}/new`}>New template</Link>
    </Button>
  );
}
