'use client';
import type { JSX } from 'react';
import { Button, Surface, Text } from '@docket/ui/primitives';
import { ArrowRight, Plus } from '@docket/ui/icons';
import Link from '@/components/docket-link';
import { workTemplateHref } from '../work-template-navigation';

/** Distinguish defining an organization's own work from adopting an existing starting point. */
export function LibraryDefineEntry({
  orgId,
  continuing,
}: {
  readonly orgId: string;
  readonly continuing: boolean;
}): JSX.Element {
  return (
    <section
      aria-label="Define another kind of work"
      className="grid min-w-0 gap-5 @2xl:grid-cols-2"
    >
      <Surface
        shape="large"
        tone="well"
        pad="roomy"
        className="flex min-w-0 flex-col items-start gap-3"
      >
        <Text as="h2" token="title-large">
          {continuing ? 'Define another kind of work' : 'What work does your organization do?'}
        </Text>
        <p className="text-body-medium text-on-surface-variant max-w-prose">
          Name the work, explain its purpose, then decide what each instance includes.
        </p>
        <Button asChild variant={continuing ? 'secondary' : 'default'} className="min-h-10">
          <Link href={workTemplateHref(orgId, '/new')}>
            <Plus aria-hidden="true" className="size-4" />
            Define work
          </Link>
        </Button>
      </Surface>
      <div className="flex min-w-0 flex-col items-start justify-center gap-3 p-4">
        <Text as="h2" token="title-medium">
          Start from an existing definition
        </Text>
        <p className="text-body-medium text-on-surface-variant max-w-prose">
          Choose work shaped around your goals. Review what it includes and adapt a private copy.
        </p>
        <Button asChild variant="ghost" className="min-h-10">
          <Link href={workTemplateHref(orgId, '/gallery')}>
            Choose starting work
            <ArrowRight aria-hidden="true" className="size-4" />
          </Link>
        </Button>
      </div>
    </section>
  );
}
