import type { OnboardingStep } from './types';

/** Per-step header copy for the {@link WizardShell}. `{name}` is interpolated when known. */
export function stepCopy(step: OnboardingStep): {
  eyebrow: string;
  title: string;
  subtitle: string;
} {
  switch (step) {
    case 'intent':
      return {
        eyebrow: 'Welcome to Docket',
        title: 'How will you use Docket?',
        subtitle: 'Choose a personal workspace or a shared organization.',
      };
    case 'name':
      return {
        eyebrow: 'Set up your organization',
        title: 'Name your organization',
        subtitle: 'This name identifies the shared organization and its data.',
      };
    case 'connect':
      return {
        eyebrow: 'Connect a source',
        title: 'Import existing work',
        subtitle:
          'Imported records stay linked to their source. You can connect a source or skip this step.',
      };
    case 'passkey':
      return {
        eyebrow: 'Secure your account',
        title: 'Add a passkey',
        subtitle: 'Your device will ask you to confirm. You can skip and add one later.',
      };
  }
}

/**
 * The primary button label for a given step and state.
 *
 * @remarks
 * On the connect step the label promotes from a neutral "Continue without connecting" to a
 * confident "Enter your workspace" once anything has been mirrored, so the primary action
 * always reads true to what the user will land in.
 */
export function primaryLabel(
  step: OnboardingStep,
  isConnectStep: boolean,
  pending: boolean,
  mirroredTotal: number,
): string {
  if (step === 'passkey') {
    return pending ? 'Adding your passkey…' : 'Add a passkey';
  }
  if (isConnectStep) {
    return mirroredTotal > 0 ? 'Enter your workspace' : 'Continue without connecting';
  }
  if (step === 'name') {
    if (pending) return 'Setting things up…';
    return 'Create workspace';
  }
  return 'Continue';
}

/** Replace a `{name}` token in header copy with `, <firstName>` when the name is known. */
export function interpolate(template: string, firstName: string | undefined): string {
  return template.replace('{name}', firstName ? `, ${firstName}` : '');
}
