'use client';
import type { JSX, ReactNode } from 'react';
import { Button, ControlGroup, Skeleton, Stack } from '@docket/ui/primitives';
import { ChevronLeft } from '@docket/ui/icons';
import Link from '@/components/docket-link';
import {
  PageContainer,
  PageHeader,
  PageHeading,
  PageSubtitle,
  PageTitle,
} from '@/components/views/page-layout';
import { workTemplateHref } from './work-template-navigation';

/** Full-page work-definition frame; the app shell remains the single scroll and navigation owner. */
export interface WorkTemplateWorkspaceFrameProps {
  readonly orgId: string;
  readonly title?: string;
  readonly description?: string;
  readonly action?: ReactNode;
  readonly parent?: { readonly label: string; readonly href?: string };
  readonly loading?: boolean;
  readonly children?: ReactNode;
}
/** Compose the shared app page slots without settings chrome, modal infrastructure or nested scrolling. */
export function WorkTemplateWorkspaceFrame({
  orgId,
  title,
  description,
  action,
  parent,
  loading = false,
  children,
}: WorkTemplateWorkspaceFrameProps): JSX.Element {
  return (
    <PageContainer as="div" className="@container max-w-6xl min-w-0 p-0 sm:p-3">
      <ControlGroup controlSize="xl" orientation="vertical" className="gap-3 sm:gap-6">
        {parent ? (
          <nav aria-label="Work templates navigation" className="px-3 pt-2 sm:px-0 sm:pt-0">
            <Button asChild variant="ghost" className="self-start px-0">
              <Link href={parent.href ?? workTemplateHref(orgId)}>
                <ChevronLeft className="size-4" aria-hidden="true" />
                {parent.label}
              </Link>
            </Button>
          </nav>
        ) : null}
        {title ? (
          <PageHeader className="flex-col items-start px-3 sm:px-0 @2xl:flex-row @2xl:items-end">
            <PageHeading>
              <PageTitle className="text-title-large sm:text-headline-large">{title}</PageTitle>
              {description ? <PageSubtitle>{description}</PageSubtitle> : null}
            </PageHeading>
            {action}
          </PageHeader>
        ) : null}
        {loading ? (
          <Stack gap={4} role="status" aria-label="Loading">
            <Skeleton className="rounded-corner-lg h-40" />
            <Skeleton className="rounded-corner-lg h-64" />
          </Stack>
        ) : (
          children
        )}
      </ControlGroup>
    </PageContainer>
  );
}
