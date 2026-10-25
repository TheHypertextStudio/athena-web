'use client';

import type { OrgCreate } from '../../lib/contracts/organization';
import { useRouter } from 'next/navigation';
import { type JSX, useCallback, useEffect, useMemo, useState } from 'react';

import { interpolate, stepCopy } from '@/components/onboarding/onboarding-copy';
import { OnboardingFooter, OnboardingNotice } from '@/components/onboarding/onboarding-footer';
import { onboardingPasskeysDef } from '@/components/onboarding/onboarding-queries';
import { workTemplateHref } from '@/components/templates/work-template-navigation';
import { StepIntent } from '@/components/onboarding/step-intent';
import { StepConnect } from '@/components/onboarding/step-connect';
import { StepPasskey } from '@/components/onboarding/step-passkey';
import type { OnboardingIntent, OnboardingStep } from '@/components/onboarding/types';
import { WizardShell } from '@/components/onboarding/wizard-shell';
import { WorkspaceNameField } from '@/components/workspace-creation/workspace-name-field';
import { useAuthenticationRecovery } from '@/components/authentication-interlock';
import { passkey, useSession } from '@/lib/auth-client';
import { userErrorMessage } from '@/lib/problem';
import { useApiQuery } from '@/lib/query';
import { createWorkspace } from '@/lib/workspace-creation';

/** The ordered steps for the individual ("just me") fork. */
const PERSONAL_STEPS: readonly OnboardingStep[] = ['intent', 'connect', 'starters'];

/** The ordered steps for the team / nonprofit fork. */
const TEAM_STEPS: readonly OnboardingStep[] = ['intent', 'name', 'connect', 'starters'];

/** Extract a friendly first name from a full display name, if any. */
function firstNameOf(name: string | undefined): string | undefined {
  const trimmed = name?.trim();
  if (!trimmed) return undefined;
  return trimmed.split(/\s+/)[0];
}

/**
 * The first-run onboarding wizard: a focused setup right after sign-up.
 *
 * @remarks
 * A Client Component that runs a small state machine. The first screen forks on intent:
 *
 * - **Just me** → create a personal workspace and open the live connection step. The personal
 *   workspace is created as soon as the user makes that selection.
 * - **Team / nonprofit** → name the org, then continue to the live connect step. New workspaces
 *   use Docket's standard terminology; intent remains an informational onboarding hint.
 *
 * Crucially the workspace is created when the user *enters* the connect step — not at the very
 * end — so the connect step has a real org to mirror work into (create integration → import).
 * The ordered step list is derived from the chosen intent so the progress indicator and
 * back/next navigation stay correct without hand-maintained branches. Once the org exists the
 * user is committed: back navigation is disabled. After optional connections and passkey enrollment,
 * the person can choose starting work through the ordinary gallery or skip into usable Home.
 * If creation fails, the wizard stays on setup with application-owned recovery copy rather than
 * advancing to a connect step without a real workspace. Submission only ever fires from the React click handler, so a pre-hydration
 * click cannot trigger a half-initialised create.
 */
export default function OnboardingPage(): JSX.Element {
  const router = useRouter();
  const { data: session } = useSession();
  const recoverAuthentication = useAuthenticationRecovery();
  const firstName = firstNameOf(session?.user.name);

  const [step, setStep] = useState<OnboardingStep>('intent');
  const [intent, setIntent] = useState<OnboardingIntent | null>(null);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  /** The created org's id, set when the user enters the connect step (commits them). */
  const [orgId, setOrgId] = useState<string | null>(null);
  /** Running total of items mirrored on the connect step (promotes the primary action). */
  const [mirroredTotal, setMirroredTotal] = useState(0);
  /**
   * Whether to include the optional passkey-enrollment beat. True only once we've confirmed the
   * account has zero passkeys (a social sign-up); defaults false so a passkey sign-up — or a check
   * that hasn't resolved — goes from connections directly to optional starting work.
   */
  const [needsPasskey, setNeedsPasskey] = useState(false);

  const passkeys = useApiQuery(onboardingPasskeysDef());
  useEffect(() => {
    if (passkeys.data?.items.length === 0) setNeedsPasskey(true);
  }, [passkeys.data]);

  /** The active fork's ordered steps; the personal fork until an intent forks it otherwise. */
  const steps = useMemo<readonly OnboardingStep[]>(() => {
    const base = intent === 'personal' || intent === null ? PERSONAL_STEPS : TEAM_STEPS;
    return needsPasskey ? [...base.slice(0, -1), 'passkey', 'starters'] : base;
  }, [intent, needsPasskey]);
  const stepIndex = Math.max(0, steps.indexOf(step));
  const isConnectStep = step === 'connect';
  const isPasskeyStep = step === 'passkey';
  const isPersonal = intent === 'personal';
  const nameReady = name.trim().length > 0;

  /** Choose an intent on step 1 and advance to its first beat. */
  const chooseIntent = useCallback((next: OnboardingIntent): void => {
    setError(null);
    setIntent(next);
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
          intent: 'personal',
          vocabulary: 'startup',
        }
      : {
          isPersonal: false,
          name: name.trim(),
          intent: intent ?? 'startup',
          vocabulary: 'startup',
        };
  }, [isPersonal, name, intent]);

  /**
   * Create the org (personal or team) and advance into the connect step bound to it.
   *
   * @remarks
   * Idempotent against re-entry: once {@link orgId} is set this is a no-op, so a double-click
   * never creates two orgs. On failure the wizard stays on the current setup step and surfaces
   * application-owned recovery copy — it never advances to a connect step without a real org behind it.
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
      const { organization } = await recoverAuthentication(() => createWorkspace(orgBody()));
      setOrgId(organization.id);
      setStep('connect');
    } catch (caught) {
      setError(userErrorMessage(caught, 'Docket could not create this workspace. Try again.'));
      if (isPersonal) setStep('intent');
    } finally {
      setPending(false);
    }
  }, [intent, pending, orgId, orgBody, recoverAuthentication]);

  useEffect(() => {
    if (intent === 'personal' && step === 'connect' && orgId === null && !pending) {
      void enterConnect();
    }
  }, [intent, step, orgId, pending, enterConnect]);

  /** Route into Home (the cross-org cockpit) — matches sign-in's landing; used by both Skip and Enter. */
  const enterWorkspace = useCallback((): void => {
    if (orgId === null) return;
    router.push('/today');
  }, [orgId, router]);

  /**
   * Leave the connect step: advance to the passkey beat when one is queued (a social sign-up),
   * otherwise offer starting work. Continuing without a connection preserves the passkey offer.
   */
  const leaveConnect = useCallback((): void => {
    if (needsPasskey) {
      setError(null);
      setStep('passkey');
      return;
    }
    setStep('starters');
  }, [needsPasskey]);

  /**
   * Enrol a passkey from the authenticated session, then offer starting work.
   *
   * @remarks
   * Session-bound registration ({@link passkey.addPasskey}) — the safe, verified path that replaced
   * the removed unauthenticated graft. On cancel/failure the wizard stays on the step and surfaces
   * the reason so the user can retry or skip; success advances to the optional starter handoff.
   */
  const enrollPasskey = useCallback(async (): Promise<void> => {
    if (pending) return;
    setError(null);
    setPending(true);
    try {
      const result = await passkey.addPasskey();
      if (result.error) {
        setError(userErrorMessage(result.error, 'Could not add a passkey. You can add one later.'));
        return;
      }
      setStep('starters');
    } catch (caught) {
      setError(
        userErrorMessage(caught, 'Could not add a passkey. You can add one later in Settings.'),
      );
    } finally {
      setPending(false);
    }
  }, [pending]);

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

  /** Keep the passkey skip in setup; only the final skip opens ordinary work. */
  const skipStep = useCallback((): void => {
    setError(null);
    if (isPasskeyStep) setStep('starters');
    else enterWorkspace();
  }, [isPasskeyStep, enterWorkspace]);

  /** Run the right action for the current step's primary button. */
  const onPrimary = useCallback((): void => {
    if (isPasskeyStep) {
      void enrollPasskey();
      return;
    }
    if (isConnectStep) {
      leaveConnect();
      return;
    }
    if (step === 'starters' && orgId !== null && intent !== null) {
      router.push(`${workTemplateHref(orgId, '/gallery')}?fork=${intent}`);
      return;
    }
    goNext();
  }, [
    isPasskeyStep,
    enrollPasskey,
    isConnectStep,
    leaveConnect,
    step,
    orgId,
    intent,
    router,
    goNext,
  ]);

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
      notice={error ? <OnboardingNotice message={error} /> : undefined}
      footer={
        <OnboardingFooter
          step={step}
          pending={pending}
          mirroredTotal={mirroredTotal}
          nameReady={nameReady}
          onPrimary={onPrimary}
          onSkip={skipStep}
        />
      }
    >
      {step === 'intent' ? <StepIntent value={intent} onChange={chooseIntent} /> : null}

      {step === 'name' ? (
        <WorkspaceNameField
          value={name}
          onChange={setName}
          onSubmit={goNext}
          canSubmit={nameReady}
        />
      ) : null}

      {step === 'connect' && orgId !== null ? (
        <StepConnect orgId={orgId} onMirroredTotalChange={setMirroredTotal} />
      ) : null}

      {step === 'connect' && orgId === null ? (
        <p className="text-on-surface-variant text-body-medium" role="status">
          Creating your workspace…
        </p>
      ) : null}

      {step === 'passkey' ? <StepPasskey /> : null}
      {step === 'starters' ? (
        <p className="text-on-surface-variant text-body-medium">
          You can find these later in Work templates.
        </p>
      ) : null}
    </WizardShell>
  );
}
