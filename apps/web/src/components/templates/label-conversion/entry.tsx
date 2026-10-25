import type { JSX } from 'react';
import type { WorkTemplateOut, WorkTemplateVersionOut } from '@docket/work/work-template-contract';
import { Button } from '@docket/ui/primitives';
import Link from '@/components/docket-link';
import { workTemplateHref } from '../work-template-navigation';
/** Enter an isolated review for an exact published identity without applying starting fields. */
export function LabelConversionEntry({
  template,
  version,
}: {
  readonly template: WorkTemplateOut;
  readonly version?: WorkTemplateVersionOut;
}): JSX.Element | null {
  const published = version ?? template.latestVersion;
  if (!published || template.isBase || template.status === 'archived' || !template.canEdit)
    return null;
  const query = new URLSearchParams({ templateId: template.id, versionId: published.id });
  return (
    <Button variant="ghost" asChild className="self-start">
      <Link href={`${workTemplateHref(template.organizationId)}/convert-labels?${query}`}>
        Apply to labelled work
      </Link>
    </Button>
  );
}
