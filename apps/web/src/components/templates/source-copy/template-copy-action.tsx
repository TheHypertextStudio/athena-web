'use client';
import { useState, type JSX } from 'react';
import type { WorkTemplateOut, WorkTemplateVersionOut } from '@docket/work/work-template-contract';
import type { WorkTemplateCopySourceSelection } from '@docket/work/template-copy';
import { Button } from '@docket/ui/primitives';
import { InlineBanner } from '@docket/ui/components';
import { useSession } from '@/lib/auth-client';
import { useAppRouter } from '@/lib/interactions/navigation';
import { userErrorMessage } from '@/lib/problem';
import { workTemplateHref } from '../work-template-navigation';
import { createSourceCopy, sourceCopyChoices } from './source-copy-session';

/** Enter focused manual copy from a saved draft or explicitly inspected immutable publication. */
export function TemplateCopyAction({
  template,
  version,
}: {
  readonly template: WorkTemplateOut;
  readonly version?: WorkTemplateVersionOut;
}): JSX.Element | null {
  const session = useSession();
  const router = useAppRouter();
  const [error, setError] = useState<string | null>(null);
  const source: WorkTemplateCopySourceSelection | undefined = version
    ? {
        kind: 'publication',
        organizationId: template.organizationId,
        workTypeId: template.id,
        selection: { kind: 'pinned', workTypeVersionId: version.id },
      }
    : sourceCopyChoices(template)[0]?.source;
  if (!source || template.isBase || template.status === 'archived') return null;
  function begin(): void {
    if (!session.data || !source) return;
    try {
      const value = createSourceCopy(
        { userId: session.data.user.id, sessionId: session.data.session.id },
        source,
      );
      router.push(`${workTemplateHref(template.organizationId)}/copy/${value.id}`);
    } catch (failure) {
      setError(userErrorMessage(failure, 'Could not start this copy. Try again.'));
    }
  }
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <Button
        wrapLabel
        type="button"
        variant="secondary"
        className="self-start"
        disabled={!session.data}
        onClick={begin}
      >
        {version ? `Copy version ${version.number}` : 'Copy to a workspace'}
      </Button>
      {error ? (
        <InlineBanner tone="critical" title="Could not start this copy">
          {error}
        </InlineBanner>
      ) : null}
    </div>
  );
}
