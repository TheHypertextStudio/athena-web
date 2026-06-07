'use client';

/**
 * `settings` — the integration connect wizard.
 *
 * @remarks
 * Connecting an external tool is a deliberate, two-step decision, so this wizard makes the
 * choice explicit up front before anything is created:
 *
 * 1. **Pick a pattern** — Migration vs Connector — with the consequences spelled out. A
 *    *Migration* means Docket takes over and the original tool is retired (Docket becomes the
 *    source of truth); a *Connector* links and mirrors the tool read-only, leaving it
 *    authoritative. The provider's recommended pattern is preselected but the owner can choose.
 * 2. **Confirm** — a plain-language summary of what will happen, then connect.
 *
 * In local development no real providers are configured, so connecting records the integration
 * in the chosen pattern without any fake "connected" health — the parent reflects whatever the
 * API returns. The wizard renders as an inline expanded panel beneath the provider card.
 */
import type { IntegrationPattern, IntegrationRole } from '@docket/types';
import { cn } from '@docket/ui';
import { Check } from '@docket/ui/icons';
import { Button } from '@docket/ui/primitives';
import type { JSX } from 'react';
import { useState } from 'react';

/** Per-pattern plain-language explanation shown in the chooser. */
const PATTERN_COPY: Record<
  IntegrationPattern,
  { title: string; consequence: string; detail: string }
> = {
  migration: {
    title: 'Migration',
    consequence: 'Docket takes over and retires the tool.',
    detail:
      'Your work moves into Docket, which becomes the single source of truth. The original tool is wound down — use this when you’re ready to switch fully.',
  },
  connector: {
    title: 'Connector',
    consequence: 'Docket links and mirrors; the tool stays authoritative.',
    detail:
      'Docket reads from the tool and shows a read-only mirror alongside your work. The original tool keeps owning the data — use this to bring context in without committing.',
  },
};

/** Props for {@link ConnectWizard}. */
export interface ConnectWizardProps {
  /** The provider display name (e.g. "GitHub"). */
  providerName: string;
  /** The pattern the directory recommends for this provider (preselected). */
  recommendedPattern: IntegrationPattern;
  /** The roles this provider contributes (for the confirm summary). */
  roles: readonly IntegrationRole[];
  /** Whether a connect is currently in flight. */
  connecting: boolean;
  /** A connect error to surface inline, if any. */
  error: string | null;
  /** Connect with the chosen pattern. */
  onConnect: (pattern: IntegrationPattern) => void;
  /** Cancel and collapse the wizard. */
  onCancel: () => void;
}

/** Human labels for the integration roles surfaced in the confirm summary. */
const ROLE_LABEL: Record<IntegrationRole, string> = {
  work: 'Work items',
  context: 'Documents & context',
  signal: 'Signals & notifications',
  time: 'Calendar & time',
  code: 'Code & repositories',
};

/**
 * The two-step connect wizard for a single provider.
 *
 * @param props - The {@link ConnectWizardProps}.
 * @returns the rendered wizard panel.
 */
export function ConnectWizard({
  providerName,
  recommendedPattern,
  roles,
  connecting,
  error,
  onConnect,
  onCancel,
}: ConnectWizardProps): JSX.Element {
  const [pattern, setPattern] = useState<IntegrationPattern>(recommendedPattern);

  return (
    <div className="border-border bg-muted/30 flex flex-col gap-4 border-t p-4">
      <fieldset className="flex flex-col gap-2">
        <legend className="text-foreground mb-1 text-xs font-semibold tracking-wide uppercase">
          How should Docket connect {providerName}?
        </legend>
        <div
          className="grid gap-2 sm:grid-cols-2"
          role="radiogroup"
          aria-label="Connection pattern"
        >
          {(['migration', 'connector'] as const).map((value) => {
            const copy = PATTERN_COPY[value];
            const isSelected = pattern === value;
            const isRecommended = value === recommendedPattern;
            return (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={isSelected}
                onClick={() => {
                  setPattern(value);
                }}
                className={cn(
                  'focus-visible:ring-ring bg-surface-container-low relative flex flex-col gap-1 rounded-lg border p-3 text-left transition-colors outline-none focus-visible:ring-2',
                  isSelected
                    ? 'border-primary bg-primary/5'
                    : 'border-outline-variant hover:border-primary/40',
                )}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="text-foreground text-sm font-semibold">{copy.title}</span>
                  {isSelected ? <Check aria-hidden="true" className="text-primary size-4" /> : null}
                </span>
                <span className="text-foreground text-xs font-medium">{copy.consequence}</span>
                <span className="text-muted-foreground text-xs leading-snug">{copy.detail}</span>
                {isRecommended ? (
                  <span className="text-muted-foreground mt-1 text-[0.625rem] font-medium tracking-wide uppercase">
                    Recommended
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      </fieldset>

      <div className="border-outline-variant bg-surface-container-low rounded-lg border p-3 text-sm">
        <p className="text-foreground">
          {pattern === 'migration' ? (
            <>
              Docket will <span className="font-semibold">take over from {providerName}</span> and
              retire it. {providerName} stops being the source of truth.
            </>
          ) : (
            <>
              Docket will <span className="font-semibold">mirror {providerName} read-only</span>.{' '}
              {providerName} stays the source of truth.
            </>
          )}
        </p>
        {roles.length > 0 ? (
          <p className="text-muted-foreground mt-1 text-xs">
            Brings in: {roles.map((role) => ROLE_LABEL[role]).join(', ')}.
          </p>
        ) : null}
      </div>

      {error ? (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      ) : null}

      <div className="flex items-center gap-2">
        <Button
          disabled={connecting}
          onClick={() => {
            onConnect(pattern);
          }}
        >
          {connecting ? 'Connecting…' : `Connect as ${PATTERN_COPY[pattern].title.toLowerCase()}`}
        </Button>
        <Button variant="ghost" disabled={connecting} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
