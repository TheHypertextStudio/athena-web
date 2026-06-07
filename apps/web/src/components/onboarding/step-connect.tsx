'use client';

/**
 * `onboarding/step-connect` — the optional, skippable "connect your accounts" beat.
 *
 * @remarks
 * Shared by both forks as the final step before the workspace is created. Connecting external
 * tools is genuinely optional, so this screen is always skippable. Crucially, this environment
 * has no integration providers wired, so it would be dishonest to render provider buttons that
 * do nothing — instead it tells the truth: tools can be connected later from Settings. When
 * real providers land, swap this honest notice for the live connect controls.
 */
import { LayoutGrid, Settings } from '@docket/ui/icons';
import type { JSX } from 'react';

/**
 * The connect-accounts step.
 *
 * @remarks
 * Presents the value of connecting tools, then honestly defers it to Settings rather than
 * stubbing provider buttons. The action row (skip / finish) is owned by the orchestrator, so
 * this component is purely presentational.
 */
export function StepConnect(): JSX.Element {
  return (
    <div className="flex flex-col gap-4">
      <div className="border-border bg-card flex items-start gap-4 rounded-xl border p-5">
        <span
          aria-hidden
          className="border-primary/30 bg-primary/10 text-primary flex size-10 shrink-0 items-center justify-center rounded-lg border"
        >
          <LayoutGrid className="size-5" />
        </span>
        <div className="flex flex-col gap-1">
          <span className="text-foreground text-base font-semibold leading-tight">
            Bring your tools together
          </span>
          <span className="text-muted-foreground text-sm leading-relaxed">
            Docket is most useful when it pulls work in from the apps you already use. There&apos;s
            nothing you have to do now — you can connect tools whenever you&apos;re ready.
          </span>
        </div>
      </div>

      <div
        className="border-border text-muted-foreground bg-muted/40 flex items-center gap-3 rounded-xl border border-dashed p-4 text-sm"
        role="note"
      >
        <Settings className="size-4 shrink-0" />
        <span>
          No integrations are connected yet. You can link your accounts anytime from{' '}
          <span className="text-foreground font-medium">Settings &rsaquo; Integrations</span>.
        </span>
      </div>
    </div>
  );
}
