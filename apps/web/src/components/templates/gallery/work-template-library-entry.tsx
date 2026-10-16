'use client';
import type { JSX } from 'react';
import { Button, ControlGroup, Surface, Text } from '@docket/ui/primitives';
import { Plus } from '@docket/ui/icons';
import Link from '@/components/docket-link';
import { workTemplateHref } from '../work-template-navigation';

/** Keep one primary entrance into authoring and one secondary entrance into curated starting work. */
export function LibraryDefineEntry({ orgId }: { readonly orgId: string }): JSX.Element {
  return (
    <ControlGroup className="max-w-full flex-wrap gap-2">
      <Button asChild className="min-h-10">
        <Link href={workTemplateHref(orgId, '/new')} navigation="activity">
          <Plus aria-hidden="true" className="size-4" />
          Define work
        </Link>
      </Button>
      <Button
        asChild
        variant="ghost"
        className="coarse:h-auto h-auto min-h-10 py-2 whitespace-normal"
      >
        <Link href={workTemplateHref(orgId, '/gallery')}>Browse starting points</Link>
      </Button>
    </ControlGroup>
  );
}

/** Explain the first decision without implying that all organizational work must repeat. */
export function LibraryEmptyState(): JSX.Element {
  return (
    <Surface as="section" shape="large" pad="roomy" className="flex flex-col gap-3 sm:p-6">
      <Text as="h2" token="headline-small">
        What work does your organization do?
      </Text>
      <p className="text-body-large text-on-surface-variant max-w-prose">
        A one-off project or an ongoing program can start with a clear purpose and a plan for what
        it includes.
      </p>
      <p className="text-body-medium text-on-surface-variant max-w-prose">
        Choose Define work to shape your own, or browse starting points to adapt an example. Save a
        draft as you go; publish when it is ready for your workspace to use.
      </p>
    </Surface>
  );
}
