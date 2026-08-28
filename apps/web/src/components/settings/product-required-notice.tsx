import { Button } from '@docket/ui/primitives';
import type { JSX } from 'react';

import DocketLink from '@/components/docket-link';

/** Props for a feature-owned Docket Pro availability notice. */
export interface ProductRequiredNoticeProps {
  readonly orgId: string;
  readonly title: string;
  readonly body: string;
}

/** Explain a paid feature in place without intercepting navigation or unrelated work. */
export function ProductRequiredNotice({
  orgId,
  title,
  body,
}: ProductRequiredNoticeProps): JSX.Element {
  return (
    <section className="border-outline-variant bg-surface-container-low flex max-w-2xl flex-col gap-3 rounded-xl border p-5">
      <div>
        <h3 className="text-on-surface text-title-medium">{title}</h3>
        <p className="text-on-surface-variant text-body-medium mt-1">{body}</p>
      </div>
      <Button asChild className="w-fit shrink-0">
        <DocketLink href={`/orgs/${orgId}/settings/billing`}>View Docket Pro</DocketLink>
      </Button>
    </section>
  );
}
