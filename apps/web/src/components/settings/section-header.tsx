/**
 * `settings` — the per-section page header.
 *
 * @remarks
 * Each routed Settings section renders the same compact header (title + one-line description)
 * above its body, so the section pages read consistently and the description copy lives in one
 * place (the {@link SETTINGS_SECTIONS} registry, passed in here). This keeps the section pages
 * themselves focused on their content.
 */
import type { JSX, ReactNode } from 'react';

/** Props for {@link SectionHeader}. */
export interface SectionHeaderProps {
  /** The section title (e.g. "Members & Access"). */
  title: string;
  /** A short, plain-language summary of the section. */
  description: string;
  /** Optional trailing content aligned to the header's end (e.g. an action). */
  action?: ReactNode;
}

/**
 * A consistent header for a Settings section page.
 *
 * @param props - The {@link SectionHeaderProps}.
 * @returns the rendered section header.
 */
export function SectionHeader({ title, description, action }: SectionHeaderProps): JSX.Element {
  return (
    <header className="border-border flex items-start justify-between gap-4 border-b pb-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-foreground text-lg font-semibold tracking-tight">{title}</h1>
        <p className="text-muted-foreground text-sm">{description}</p>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </header>
  );
}
