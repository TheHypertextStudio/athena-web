'use client';

/**
 * The project properties panel — lead, dates, program, and initiative.
 *
 * @remarks
 * A sidebar-style summary of the project's structural metadata, mirroring Linear's project
 * properties rail. The lead renders as an {@link ActorAvatar} + name; dates as short
 * locale-aware days; the program and initiative as entity chips whose nouns are resolved
 * through {@link useVocabulary} so an agency sees "Retainer"/"Engagement" where a startup
 * sees "Program"/"Initiative". Every row degrades to a muted "Not set" when its value is
 * absent, so the panel always reads as a complete, scannable list.
 */
import { cn } from '@docket/ui';
import { ActorAvatar } from '@docket/ui/components';
import { useVocabulary } from '@docket/ui/hooks';
import { FolderKanban, LayoutGrid, RefreshCw, User } from '@docket/ui/icons';
import type { JSX, ReactNode } from 'react';

import type { ActorInfo } from './actor-directory';

/** A single labeled row in the properties panel. */
function PropertyRow({
  icon,
  label,
  children,
}: {
  icon: ReactNode;
  label: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <div className="flex items-start gap-3 py-2.5">
      <span aria-hidden="true" className="text-muted-foreground mt-0.5 flex size-4 shrink-0">
        {icon}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
          {label}
        </span>
        <div className="text-foreground min-w-0 text-sm">{children}</div>
      </div>
    </div>
  );
}

/** A muted "Not set" placeholder for an absent property value. */
function NotSet(): JSX.Element {
  return <span className="text-muted-foreground italic">Not set</span>;
}

/** Format an ISO date as a short, locale-aware day, or `null` when absent. */
function formatDate(value: string | null | undefined): string | null {
  if (!value) return null;
  return new Date(value).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/** Props for {@link PropertiesPanel}. */
export interface PropertiesPanelProps {
  /** The resolved project lead, or `null` when unassigned. */
  lead: ActorInfo | null;
  /** ISO start date, when scheduled. */
  startDate: string | null | undefined;
  /** ISO target date, when scheduled. */
  targetDate: string | null | undefined;
  /** The parent program's name, or `null` when none. */
  programName: string | null;
  /** The associated initiative's name, or `null` when none. */
  initiativeName: string | null;
}

/**
 * The project properties panel.
 *
 * @param props - The {@link PropertiesPanelProps}.
 * @returns the rendered panel.
 */
export function PropertiesPanel({
  lead,
  startDate,
  targetDate,
  programName,
  initiativeName,
}: PropertiesPanelProps): JSX.Element {
  const programLabel = useVocabulary('program');
  const initiativeLabel = useVocabulary('initiative');
  const start = formatDate(startDate);
  const target = formatDate(targetDate);

  return (
    <div className="border-border bg-card flex flex-col rounded-xl border px-4 py-2">
      <h2 className="sr-only">Properties</h2>

      <PropertyRow icon={<User className="size-4" />} label="Lead">
        {lead ? (
          <span className="flex items-center gap-2">
            <ActorAvatar kind={lead.kind} name={lead.name} size={20} />
            <span className="truncate">{lead.name}</span>
          </span>
        ) : (
          <NotSet />
        )}
      </PropertyRow>

      <div className="border-border border-t" />
      <PropertyRow icon={<RefreshCw className="size-4" />} label="Timeline">
        {start || target ? (
          <span className="tabular-nums">
            {start ?? '—'} <span className="text-muted-foreground">→</span> {target ?? '—'}
          </span>
        ) : (
          <NotSet />
        )}
      </PropertyRow>

      <div className="border-border border-t" />
      <PropertyRow icon={<FolderKanban className="size-4" />} label={programLabel}>
        {programName ? <EntityChip name={programName} /> : <NotSet />}
      </PropertyRow>

      <div className="border-border border-t" />
      <PropertyRow icon={<LayoutGrid className="size-4" />} label={initiativeLabel}>
        {initiativeName ? <EntityChip name={initiativeName} /> : <NotSet />}
      </PropertyRow>
    </div>
  );
}

/** A small inline chip for a related entity (program / initiative). */
function EntityChip({ name, className }: { name: string; className?: string }): JSX.Element {
  return (
    <span
      className={cn(
        'bg-muted text-foreground ring-border inline-flex max-w-full items-center rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset',
        className,
      )}
    >
      <span className="truncate">{name}</span>
    </span>
  );
}
