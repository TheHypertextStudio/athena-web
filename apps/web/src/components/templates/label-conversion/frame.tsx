import { useEffect, useRef, type JSX, type ReactNode } from 'react';
import { Button } from '@docket/ui/primitives';
import { ImmersiveShell, InlineBanner } from '@docket/ui/components';
import { ChevronLeft } from '@docket/ui/icons';
import Link from '@/components/docket-link';
import { useOptionalActiveOrg } from '@/components/active-org';
import { workTemplateHref } from '../work-template-navigation';
import type { ConversionPageProps, ConversionCommand } from './types';
/** One compact gutter and persistent actions keep the selected work as the only scrolling region. */
export function ConversionFrame({
  orgId,
  templateId,
  command,
  footer,
  children,
}: ConversionPageProps & {
  readonly command: ConversionCommand;
  readonly footer?: ReactNode;
  readonly children: ReactNode;
}): JSX.Element {
  const workspace = useOptionalActiveOrg()?.orgs.find((org) => org.id === orgId);
  const error = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (command.error) error.current?.focus();
  }, [command.error]);
  return (
    <ImmersiveShell
      header={
        <nav
          aria-label="Apply template navigation"
          className="flex min-w-0 items-center justify-between gap-2"
        >
          {command.phase === 'ready' && command.review && !command.receipt ? (
            <Button variant="ghost" className="h-auto min-h-10 px-0" onClick={command.back}>
              <ChevronLeft aria-hidden="true" className="size-4 shrink-0" />
              Choose work
            </Button>
          ) : (
            <Button asChild variant="ghost" className="px-0">
              <Link href={workTemplateHref(orgId, templateId)}>
                <ChevronLeft aria-hidden="true" className="size-4" />
                Template
              </Link>
            </Button>
          )}
          <span className="text-body-small text-on-surface-variant min-w-0 truncate">
            {workspace?.name}
          </span>
        </nav>
      }
      footer={footer ? <div className="mx-auto w-full max-w-3xl min-w-0">{footer}</div> : undefined}
    >
      <div className="mx-auto flex w-full max-w-3xl min-w-0 flex-col gap-4 px-3 pb-6 sm:px-6">
        {command.error ? (
          <div ref={error} tabIndex={-1} className="outline-none">
            <InlineBanner tone="critical" title="This change needs attention">
              {command.error}
            </InlineBanner>
          </div>
        ) : null}
        {children}
      </div>
    </ImmersiveShell>
  );
}
