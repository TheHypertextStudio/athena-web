'use client';

/**
 * `onboarding/wizard-shell` — the shared chrome wrapping every onboarding step.
 *
 * @remarks
 * Each step renders the same frame: a centered column with a brand mark, a step/progress
 * indicator, an eyebrow + title + subtitle header, the step body, and a footer action row
 * with optional back navigation. Keeping this in one place gives every screen identical
 * spacing, typography, and transition behaviour, so the steps themselves stay focused on
 * their one concept. The body keys off the current step so React remounts it between steps,
 * which re-triggers the enter animation for a smooth, deliberate transition.
 */
import { ChevronLeft, Sparkles } from '@docket/ui/icons';
import { cn } from '@docket/ui/lib/utils';
import { Button } from '@docket/ui/primitives';
import type { JSX, ReactNode } from 'react';

/** Props for {@link WizardShell}. */
export interface WizardShellProps {
  /** A stable key for the current step; changing it re-runs the body's enter animation. */
  stepKey: string;
  /** The 1-based index of the current step within {@link totalSteps}. */
  stepNumber: number;
  /** The total number of steps in the current fork (drives the progress indicator). */
  totalSteps: number;
  /**
   * Whether the total step count is settled enough to commit to the user.
   *
   * @remarks
   * Before the wizard forks (the intent screen), the number of remaining beats is genuinely
   * unknown — picking "Just me" vs "My team" yields different fork lengths. Showing a concrete
   * "Step 1 of N" there would make the total visibly change under the user the instant they
   * choose, which reads as a glitch against a polished bar. When this is `false` the indicator
   * shows a neutral "Getting started" label and a single un-committed lead segment instead of a
   * committed "Step N of M" + full segmented bar.
   */
  totalKnown?: boolean;
  /** A short label above the title (e.g. "Get started"). */
  eyebrow: string;
  /** The step's headline. */
  title: string;
  /** A one-line explanation of the step. */
  subtitle: string;
  /** The step's body content. */
  children: ReactNode;
  /** The footer action row (primary / secondary buttons). */
  footer: ReactNode;
  /** Invoked when the back affordance is used; omit on the first step to hide it. */
  onBack?: () => void;
}

/**
 * The centered, animated frame shared by all onboarding steps.
 *
 * @remarks
 * The progress indicator is a segmented bar (one segment per step) rather than a bare
 * percentage so the user can see both how far along they are and how many beats remain.
 */
export function WizardShell({
  stepKey,
  stepNumber,
  totalSteps,
  totalKnown = true,
  eyebrow,
  title,
  subtitle,
  children,
  footer,
  onBack,
}: WizardShellProps): JSX.Element {
  return (
    <main className="bg-background text-foreground flex min-h-screen flex-col px-6 py-10 sm:py-16">
      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col">
        <header className="mb-10 flex flex-col gap-6">
          <div className="flex items-center justify-between">
            <span className="text-foreground flex items-center gap-2 text-sm font-semibold tracking-tight">
              <Sparkles className="text-primary size-4" />
              Docket
            </span>
            <span className="text-muted-foreground text-xs font-medium tabular-nums">
              {totalKnown ? `Step ${stepNumber} of ${totalSteps}` : 'Getting started'}
            </span>
          </div>

          {totalKnown ? (
            <div
              className="flex gap-1.5"
              role="progressbar"
              aria-valuemin={1}
              aria-valuemax={totalSteps}
              aria-valuenow={stepNumber}
              aria-label={`Onboarding progress: step ${stepNumber} of ${totalSteps}`}
            >
              {Array.from({ length: totalSteps }, (_, i) => (
                <span
                  key={i}
                  aria-hidden
                  className={cn(
                    'h-1.5 flex-1 rounded-full transition-colors duration-300',
                    i < stepNumber ? 'bg-primary' : 'bg-border',
                  )}
                />
              ))}
            </div>
          ) : (
            <div
              className="flex gap-1.5"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={0}
              aria-label="Onboarding progress: getting started"
            >
              {/* Total unknown until the wizard forks: a single, un-committed lead segment
                  so the bar doesn't claim a step count it will immediately have to change. */}
              <span aria-hidden className="bg-primary h-1.5 w-10 rounded-full" />
              <span aria-hidden className="bg-border h-1.5 flex-1 rounded-full" />
            </div>
          )}
        </header>

        <div
          key={stepKey}
          className="animate-in fade-in slide-in-from-bottom-2 flex flex-1 flex-col duration-300"
        >
          <div className="mb-8 flex flex-col gap-2">
            <span className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
              {eyebrow}
            </span>
            <h1 className="text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
              {title}
            </h1>
            <p className="text-muted-foreground max-w-xl text-balance text-base">{subtitle}</p>
          </div>

          <div className="flex-1">{children}</div>

          <div className="mt-10 flex items-center justify-between gap-4">
            {onBack ? (
              <Button type="button" variant="ghost" onClick={onBack} className="gap-1.5">
                <ChevronLeft className="size-4" />
                Back
              </Button>
            ) : (
              <span aria-hidden />
            )}
            <div className="flex items-center gap-3">{footer}</div>
          </div>
        </div>
      </div>
    </main>
  );
}
