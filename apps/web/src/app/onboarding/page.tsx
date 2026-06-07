'use client';

import type { OrgCreate, OrgCreateResult } from '@docket/types';
import { cn } from '@docket/ui/lib/utils';
import { Button } from '@docket/ui/primitives';
import { useRouter } from 'next/navigation';
import { type JSX, useCallback, useMemo, useState } from 'react';

import { INTENT_OPTIONS, StepIntent } from '@/components/onboarding/step-intent';
import { StepConnect } from '@/components/onboarding/step-connect';
import { StepName } from '@/components/onboarding/step-name';
import { StepPersonalWelcome } from '@/components/onboarding/step-personal-welcome';
import { StepVocabulary } from '@/components/onboarding/step-vocabulary';
import type { OnboardingIntent, OnboardingStep, Vocabulary } from '@/components/onboarding/types';
import { WizardShell } from '@/components/onboarding/wizard-shell';
import { api } from '@/lib/api';
import { useSession } from '@/lib/auth-client';
import { readError, readProblem } from '@/lib/problem';

/** The ordered steps for the individual ("just me") fork. */
const PERSONAL_STEPS: readonly OnboardingStep[] = ['intent', 'personal-welcome', 'connect'];

/** The ordered steps for the team / nonprofit fork. */
const TEAM_STEPS: readonly OnboardingStep[] = ['intent', 'name', 'vocabulary', 'connect'];

/**
 * Create an organization through the typed RPC, accepting any valid {@link OrgCreate} body.
 *
 * @param body - A validated org-create body (team or personal).
 * @returns the raw RPC {@link Response} for the caller to branch on.
 */
function createOrg(body: OrgCreate): Promise<Response> {
  return api.v1.orgs.$post({ json: body });
}

/** Resolve the default vocabulary preset an intent fork pre-selects. */
function defaultVocabularyFor(intent: OnboardingIntent): Vocabulary {
  return INTENT_OPTIONS.find((option) => option.intent === intent)?.vocabulary ?? 'startup';
}

/** Extract a friendly first name from a full display name, if any. */
function firstNameOf(name: string | undefined): string | undefined {
  const trimmed = name?.trim();
  if (!trimmed) return undefined;
  return trimmed.split(/\s+/)[0];
}

/**
 * The first-run onboarding wizard: a polished, multi-step setup right after sign-up.
 *
 * @remarks
 * A Client Component that runs a small state machine. The first screen forks on intent:
 *
 * - **Just me** → a welcome beat that explains the personal command center, then an optional
 *   connect step. On finish it silently creates a personal space
 *   (`isPersonal: true`, named after the signed-in user when known) and routes to My Work.
 * - **Team / nonprofit** → name the org, choose a vocabulary preset (with a live preview drawn
 *   from the real presets), then an optional connect step. On finish it creates the org with
 *   the chosen name + vocabulary + intent and routes to My Work.
 *
 * The ordered step list is derived from the chosen intent so the progress indicator and
 * back/next navigation stay correct without hand-maintained branches. On success it routes to
 * the new org's My Work, where the app shell loads the org's teams (so task creation works on a
 * fresh session); on failure the `Problem` response body is surfaced inline. Submission only
 * ever fires from the React click handler, so a pre-hydration click cannot trigger a
 * half-initialised create.
 */
export default function OnboardingPage(): JSX.Element {
  const router = useRouter();
  const { data: session } = useSession();
  const firstName = firstNameOf(session?.user.name);

  const [step, setStep] = useState<OnboardingStep>('intent');
  const [intent, setIntent] = useState<OnboardingIntent | null>(null);
  const [name, setName] = useState('');
  const [vocabulary, setVocabulary] = useState<Vocabulary>('startup');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  /** The active fork's ordered steps; the personal fork until an intent forks it otherwise. */
  const steps = useMemo<readonly OnboardingStep[]>(
    () => (intent === 'personal' || intent === null ? PERSONAL_STEPS : TEAM_STEPS),
    [intent],
  );
  const stepIndex = Math.max(0, steps.indexOf(step));
  const isLastStep = stepIndex === steps.length - 1;
  const isPersonal = intent === 'personal';
  const nameReady = name.trim().length > 0;

  /** Choose an intent on step 1, adopt its default vocabulary, and advance to its first beat. */
  const chooseIntent = useCallback((next: OnboardingIntent): void => {
    setError(null);
    setIntent(next);
    setVocabulary(defaultVocabularyFor(next));
    const forkSteps = next === 'personal' ? PERSONAL_STEPS : TEAM_STEPS;
    setStep(forkSteps[1] ?? 'connect');
  }, []);

  /** Step back one beat; from the second step this returns to (and clears) the intent fork. */
  const goBack = useCallback((): void => {
    setError(null);
    const previous = steps[stepIndex - 1];
    if (!previous) return;
    if (previous === 'intent') setIntent(null);
    setStep(previous);
  }, [steps, stepIndex]);

  /** Advance to the next step in the active fork. */
  const goNext = useCallback((): void => {
    setError(null);
    const next = steps[stepIndex + 1];
    if (next) setStep(next);
  }, [steps, stepIndex]);

  /** Create the org (personal or team) and route to its My Work. */
  const finish = useCallback(async (): Promise<void> => {
    if (intent === null || pending) return;
    setError(null);
    setPending(true);
    try {
      const body: OrgCreate = isPersonal
        ? {
            isPersonal: true,
            name: firstName ? `${firstName}'s space` : 'Personal',
            intent: 'personal',
            vocabulary: 'startup',
          }
        : { isPersonal: false, name: name.trim(), intent, vocabulary };

      const res = await createOrg(body);
      if (!res.ok) {
        setError(
          await readProblem(res, 'Could not finish setting up your workspace. Please try again.'),
        );
        return;
      }
      const { organization } = (await res.json()) as OrgCreateResult;
      router.push(`/orgs/${organization.id}/my-work`);
    } catch (caught) {
      setError(
        readError(caught, 'Something went wrong setting up your workspace. Please try again.'),
      );
    } finally {
      setPending(false);
    }
  }, [intent, isPersonal, firstName, name, vocabulary, pending, router]);

  /** Run the right action for the current step's primary button (advance vs. finish). */
  const onPrimary = useCallback((): void => {
    if (isLastStep) {
      void finish();
      return;
    }
    goNext();
  }, [isLastStep, finish, goNext]);

  const copy = stepCopy(step);

  return (
    <WizardShell
      stepKey={step}
      stepNumber={stepIndex + 1}
      totalSteps={steps.length}
      totalKnown={intent !== null}
      eyebrow={copy.eyebrow}
      title={interpolate(copy.title, firstName)}
      subtitle={copy.subtitle}
      onBack={step === 'intent' ? undefined : goBack}
      footer={
        <>
          {error ? (
            <p role="alert" className="text-destructive mr-1 text-sm">
              {error}
            </p>
          ) : null}
          {step === 'connect' ? (
            <Button type="button" variant="ghost" onClick={onPrimary} disabled={pending}>
              Skip for now
            </Button>
          ) : null}
          {step === 'intent' ? null : (
            <Button
              type="button"
              onClick={onPrimary}
              disabled={pending || (step === 'name' && !nameReady)}
              className={cn(isLastStep && 'min-w-44')}
            >
              {primaryLabel(isLastStep, isPersonal, pending)}
            </Button>
          )}
        </>
      }
    >
      {step === 'intent' ? <StepIntent value={intent} onChange={chooseIntent} /> : null}

      {step === 'personal-welcome' ? <StepPersonalWelcome firstName={firstName} /> : null}

      {step === 'name' ? (
        <StepName value={name} onChange={setName} onSubmit={goNext} canSubmit={nameReady} />
      ) : null}

      {step === 'vocabulary' ? (
        <StepVocabulary value={vocabulary} onChange={setVocabulary} />
      ) : null}

      {step === 'connect' ? <StepConnect /> : null}
    </WizardShell>
  );
}

/** Per-step header copy for the {@link WizardShell}. `{name}` is interpolated when known. */
function stepCopy(step: OnboardingStep): { eyebrow: string; title: string; subtitle: string } {
  switch (step) {
    case 'intent':
      return {
        eyebrow: 'Welcome to Docket',
        title: 'What brings you to Docket?',
        subtitle: "We'll tailor your setup to how you work. You can change any of this later.",
      };
    case 'personal-welcome':
      return {
        eyebrow: 'Your command center',
        title: 'This is your space{name}',
        subtitle:
          'A calm home for everything you’re working on — and a launchpad for shared workspaces when you need them.',
      };
    case 'name':
      return {
        eyebrow: 'Set up your organization',
        title: 'Name your organization',
        subtitle:
          'Give your team’s shared space a name. Don’t overthink it — you can change it later.',
      };
    case 'vocabulary':
      return {
        eyebrow: 'Make it yours',
        title: 'Docket speaks your world’s language',
        subtitle:
          'Pick the words that fit how your organization talks. Docket will use them everywhere.',
      };
    case 'connect':
      return {
        eyebrow: 'Almost there',
        title: 'Connect your accounts',
        subtitle:
          'Optional — bring in work from the tools you already use. You can always skip this.',
      };
  }
}

/** The primary button label for a given step and submit state. */
function primaryLabel(isLastStep: boolean, isPersonal: boolean, pending: boolean): string {
  if (!isLastStep) return 'Continue';
  if (pending) return 'Setting things up…';
  return isPersonal ? 'Enter your space' : 'Create workspace';
}

/** Replace a `{name}` token in header copy with `, <firstName>` when the name is known. */
function interpolate(template: string, firstName: string | undefined): string {
  return template.replace('{name}', firstName ? `, ${firstName}` : '');
}
