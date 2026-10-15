'use client';
import type { TemplateTargetType } from '@docket/work/template-contract';
import type { WorkTemplateOut } from '@docket/work/work-template-contract';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@docket/ui/primitives';
import { ChevronDown, LayoutTemplate } from '@docket/ui/icons';
import { templateStartingStatus } from './template-starting-status';
import { statusSetsDef } from '@/components/statuses/queries';
import type { JSX } from 'react';
import Link from '@/components/docket-link';
import { workTemplatesDef } from '@/components/templates/work-template-queries';
import { sectionHref } from '@/components/settings/settings-registry';
import { useApiQuery } from '@/lib/query';

/** Creation identity remains visible after a starting document has been filled in. */
export function WorkTemplatePicker({
  orgId,
  kind,
  teamId,
  selectedId,
  selectedVersionId,
  onSelect,
  disabled,
}: {
  orgId: string;
  kind: TemplateTargetType;
  teamId: string | null;
  selectedId?: string | null | undefined;
  selectedVersionId?: string | null | undefined;
  onSelect: (template: WorkTemplateOut, startingStatus?: string) => void;
  disabled: boolean;
}): JSX.Element {
  const query = useApiQuery(workTemplatesDef(orgId, { targetType: kind }));
  const statusQuery = useApiQuery(
    statusSetsDef(orgId, kind === 'task' ? (teamId ?? undefined) : undefined),
  );
  const templates = (query.data?.items ?? []).filter(
    (item) => item.offeredTeamIds.length === 0 || item.offeredTeamIds.some((id) => id === teamId),
  );
  if (query.isError || statusQuery.isError)
    return (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={disabled}
        onClick={() => {
          void Promise.allSettled([query.refetch(), statusQuery.refetch()]);
        }}
      >
        Templates unavailable · Retry
      </Button>
    );
  const { label, earlier } = selectionLabel(templates, selectedId, selectedVersionId);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled || query.isPending || statusQuery.isPending}
          className="max-w-56"
        >
          <LayoutTemplate className="size-4 shrink-0" />
          <span className="truncate">
            {label}
            {earlier ? ' · Earlier version' : ''}
          </span>
          <ChevronDown className="size-4 shrink-0" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" width="lg">
        <DropdownMenuLabel>Start from…</DropdownMenuLabel>
        {templates.map((item) => (
          <DropdownMenuItem
            key={item.id}
            onSelect={() => {
              const status = templateStartingStatus(item, statusQuery.data?.items ?? [], teamId);
              if (status) onSelect(item, status);
              else onSelect(item);
            }}
            {...(item.definition.description ? { supporting: item.definition.description } : {})}
          >
            {item.definition.name}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href={sectionHref(orgId, 'templates')}>Manage templates…</Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function selectionLabel(
  templates: readonly WorkTemplateOut[],
  id: string | null | undefined,
  versionId: string | null | undefined,
): { label: string; earlier: boolean } {
  const selected = id
    ? templates.find((item) => item.id === id)
    : templates.find((item) => item.isBase);
  return {
    label: selected?.definition.name ?? (id ? 'Template unavailable' : 'Template'),
    earlier: Boolean(
      versionId && selected?.latestVersion && versionId !== selected.latestVersion.id,
    ),
  };
}
