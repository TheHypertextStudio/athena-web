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
        subtitle: 'Plan on your own or work together.',
      };
    case 'name':
      return {
        eyebrow: 'Set up your workspace',
        title: 'Name your workspace',
        subtitle: 'Give your team a place to plan and work together.',
      };
    case 'connect':
      return {
        eyebrow: 'Connect an app',
        title: 'Bring in your work',
        subtitle:
          'Import tasks and events from apps you already use. Each item stays linked to its app.',
      };
    case 'starters':
      return {
        eyebrow: 'Your workspace is ready',
        title: 'Give your work a starting point',
        subtitle: 'Choose reusable plans you can make your own, or continue to your workspace.',
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
 * simple "Continue" once anything has been mirrored, before the optional passkey and starter
 * handoff. Only the final skip or gallery choice leaves setup.
 */
export function primaryLabel(
  step: OnboardingStep,
  isConnectStep: boolean,
  pending: boolean,
  mirroredTotal: number,
): string {
  if (step === 'starters') return 'Choose starting work';
  if (step === 'passkey') {
    return pending ? 'Adding your passkey…' : 'Add a passkey';
  }
  if (isConnectStep) {
    return mirroredTotal > 0 ? 'Continue' : 'Continue without connecting';
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
