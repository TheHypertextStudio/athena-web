'use client';

import type { OrgCreate, OrgCreateResult } from '@docket/types';
import { cn } from '@docket/ui/lib/utils';
import { Button } from '@docket/ui/primitives';
import { useRouter } from 'next/navigation';
import { type JSX, useCallback, useMemo, useState } from 'react';

import { interpolate, primaryLabel, stepCopy } from '@/components/onboarding/onboarding-copy';
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
 * - **Just me** → a welcome beat that explains the personal command center, then the live
 *   connect step. The personal space (`isPersonal: true`, named after the signed-in user when
 *   known) is created silently when the user leaves the welcome beat.
 * - **Team / nonprofit** → name the org, choose a vocabulary preset (with a live preview drawn
 *   from the real presets), then the live connect step. The org is created with the chosen
 *   name + vocabulary + intent when the user leaves the vocabulary beat.
 *
 * Crucially the workspace is created when the user *enters* the connect step — not at the very
 * end — so the connect step has a real org to mirror work into (create integration → import).
 * The ordered step list is derived from the chosen intent so the progress indicator and
 * back/next navigation stay correct without hand-maintained branches. Once the org exists the
 * user is committed: back navigation is disabled, and both "Skip for now" and "Enter your
 * workspace" route to the new org's My Work — populated by whatever was mirrored, or empty but
 * usable when skipped. If the create call fails, the wizard stays on the setup step and
 * surfaces the `Problem` response body inline rather than advancing to a connect step with no
 * org behind it. Submission only ever fires from the React click handler, so a pre-hydration
 * click cannot trigger a half-initialised create.
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

  /** The created org's id, set when the user enters the connect step (commits them). */
  const [orgId, setOrgId] = useState<string | null>(null);
  /** Running total of items mirrored on the connect step (promotes the primary action). */
  const [mirroredTotal, setMirroredTotal] = useState(0);

  /** The active fork's ordered steps; the personal fork until an intent forks it otherwise. */
  const steps = useMemo<readonly OnboardingStep[]>(
    () => (intent === 'personal' || intent === null ? PERSONAL_STEPS : TEAM_STEPS),
    [intent],
  );
  const stepIndex = Math.max(0, steps.indexOf(step));
  const isConnectStep = step === 'connect';
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

  /**
   * Step back one beat; from the second step this returns to (and clears) the intent fork.
   *
   * @remarks
   * Once the org has been created (the connect step) the user is committed, so back navigation
   * is unavailable — there is nothing to step back into without un-creating the workspace.
   */
  const goBack = useCallback((): void => {
    if (orgId !== null) return;
    setError(null);
    const previous = steps[stepIndex - 1];
    if (!previous) return;
    if (previous === 'intent') setIntent(null);
    setStep(previous);
  }, [steps, stepIndex, orgId]);

  /** Build the org-create body for the chosen fork. */
  const orgBody = useCallback((): OrgCreate => {
    return isPersonal
      ? {
          isPersonal: true,
          name: firstName ? `${firstName}'s space` : 'Personal',
          intent: 'personal',
          vocabulary: 'startup',
        }
      : { isPersonal: false, name: name.trim(), intent: intent ?? 'startup', vocabulary };
  }, [isPersonal, firstName, name, intent, vocabulary]);

  /**
   * Create the org (personal or team) and advance into the connect step bound to it.
   *
   * @remarks
   * Idempotent against re-entry: once {@link orgId} is set this is a no-op, so a double-click
   * never creates two orgs. On failure the wizard stays on the current setup step and surfaces
   * the server's message — it never advances to a connect step without a real org behind it.
   */
  const enterConnect = useCallback(async (): Promise<void> => {
    if (intent === null || pending) return;
    if (orgId !== null) {
      setStep('connect');
      return;
    }
    setError(null);
    setPending(true);
    try {
      const res = await createOrg(orgBody());
      if (!res.ok) {
        setError(
          await readProblem(res, 'Could not finish setting up your workspace. Please try again.'),
        );
        return;
      }
      const { organization } = (await res.json()) as OrgCreateResult;
      setOrgId(organization.id);
      setStep('connect');
    } catch (caught) {
      setError(
        readError(caught, 'Something went wrong setting up your workspace. Please try again.'),
      );
    } finally {
      setPending(false);
    }
  }, [intent, pending, orgId, orgBody]);

  /** Route into Home (the cross-org cockpit) — matches sign-in's landing; used by both Skip and Enter. */
  const enterWorkspace = useCallback((): void => {
    if (orgId === null) return;
    router.push('/today');
  }, [orgId, router]);

  /** Advance to the next step; the setup→connect hop creates the org first. */
  const goNext = useCallback((): void => {
    setError(null);
    const next = steps[stepIndex + 1];
    if (next === 'connect') {
      void enterConnect();
      return;
    }
    if (next) setStep(next);
  }, [steps, stepIndex, enterConnect]);

  /** Run the right action for the current step's primary button. */
  const onPrimary = useCallback((): void => {
    if (isConnectStep) {
      enterWorkspace();
      return;
    }
    goNext();
  }, [isConnectStep, enterWorkspace, goNext]);

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
      onBack={step === 'intent' || orgId !== null ? undefined : goBack}
      footer={
        <>
          {error ? (
            <p role="alert" className="text-destructive text-body mr-1">
              {error}
            </p>
          ) : null}
          {isConnectStep && mirroredTotal === 0 ? (
            <Button type="button" variant="ghost" onClick={enterWorkspace}>
              Skip for now
            </Button>
          ) : null}
          {step === 'intent' ? null : (
            <Button
              type="button"
              onClick={onPrimary}
              disabled={pending || (step === 'name' && !nameReady)}
              className={cn(isConnectStep && 'min-w-44')}
            >
              {primaryLabel(step, isConnectStep, isPersonal, pending, mirroredTotal)}
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

      {step === 'connect' && orgId !== null ? (
        <StepConnect orgId={orgId} onMirroredTotalChange={setMirroredTotal} />
      ) : null}
    </WizardShell>
  );
}
