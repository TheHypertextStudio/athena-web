'use client';
import type { TemplateTargetType } from '@docket/work/template-contract';
import type { WorkTemplateChoice, WorkTemplateDisplay } from '@docket/work/work-template-reference';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@docket/ui/primitives';
import { ChevronDown } from '@docket/ui/icons';
import { type JSX, useState } from 'react';
import { useInfiniteApiQuery } from '@/lib/query';
import { workTemplateGlyph } from '@/components/work-views/work-template-label';
import { workTemplateChoicesDef } from './work-template-identity-queries';

/** Compact shared name, glyph and pinned version for editors and publication-only readers. */
export function WorkTemplateIdentityLabel({
  kind,
  current,
}: {
  readonly kind: TemplateTargetType;
  readonly current: WorkTemplateDisplay;
}): JSX.Element {
  return (
    <>
      {workTemplateGlyph(kind, current.icon)}
      <span className="truncate">{current.name}</span>
      <span className="text-on-surface-variant shrink-0">
        Version {current.versionNumber}
        {current.archived ? ' · Archived' : ''}
      </span>
    </>
  );
}

/** Lazily discover small, team-offered identity choices when the change menu opens. */
export function WorkTemplateChoiceMenu({
  orgId,
  kind,
  teamId,
  current,
  versionId,
  onSelect,
}: {
  readonly orgId: string;
  readonly kind: TemplateTargetType;
  readonly teamId: string | null;
  readonly current: WorkTemplateDisplay;
  readonly versionId: string | undefined;
  readonly onSelect: (choice: WorkTemplateChoice) => void;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const choices = useInfiniteApiQuery(workTemplateChoicesDef(orgId, kind, teamId, open));
  const items = choices.data?.pages.flatMap((page) => page.items) ?? [];
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label={`Change template: ${current.name}, Version ${String(current.versionNumber)}`}
          className="max-w-full"
        >
          <WorkTemplateIdentityLabel kind={kind} current={current} />
          <ChevronDown className="size-4 shrink-0" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" width="lg">
        {choices.isError && items.length === 0 ? (
          <DropdownMenuItem
            onSelect={(event) => {
              event.preventDefault();
              void choices.refetch();
            }}
          >
            Templates unavailable · Retry
          </DropdownMenuItem>
        ) : choices.isPending ? (
          <DropdownMenuItem disabled>Loading templates…</DropdownMenuItem>
        ) : (
          items.map((choice) => (
            <DropdownMenuItem
              key={choice.id}
              disabled={choice.id === current.id && choice.versionId === versionId}
              onSelect={() => {
                onSelect(choice);
              }}
            >
              {workTemplateGlyph(kind, choice.icon)}
              {choice.name} · Version {choice.versionNumber}
            </DropdownMenuItem>
          ))
        )}
        {choices.hasNextPage ? (
          <DropdownMenuItem
            disabled={choices.isFetchingNextPage}
            onSelect={(event) => {
              event.preventDefault();
              void choices.fetchNextPage();
            }}
          >
            {choices.isError
              ? 'More templates unavailable · Retry'
              : choices.isFetchingNextPage
                ? 'Loading…'
                : 'More templates…'}
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
