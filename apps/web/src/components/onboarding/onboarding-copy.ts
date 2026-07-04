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
        eyebrow: 'Bring in your work',
        title: 'Start with what you already use',
        subtitle:
          'Connect a tool to fill your workspace with your real tasks and deadlines. Connect as many as you like — or skip and start fresh.',
      };
    case 'passkey':
      return {
        eyebrow: 'Secure your account',
        title: 'Add a passkey to sign in faster',
        subtitle:
          'Skip passwords for good — use Face ID, Touch ID, or a security key to sign in. It only takes a moment, and you can always add one later.',
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
  isPersonal: boolean,
  pending: boolean,
  mirroredTotal: number,
): string {
  if (step === 'passkey') {
    return pending ? 'Adding your passkey…' : 'Add a passkey';
  }
  if (isConnectStep) {
    return mirroredTotal > 0 ? 'Enter your workspace' : 'Continue without connecting';
  }
  if (step === 'vocabulary' || step === 'personal-welcome') {
    if (pending) return 'Setting things up…';
    return isPersonal ? 'Create your space' : 'Create workspace';
  }
  return 'Continue';
}

/** Replace a `{name}` token in header copy with `, <firstName>` when the name is known. */
export function interpolate(template: string, firstName: string | undefined): string {
  return template.replace('{name}', firstName ? `, ${firstName}` : '');
}
