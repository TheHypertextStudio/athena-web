/**
 * Stable test IDs for onboarding UI.
 */

export const ONBOARDING_TEST_IDS = {
  root: 'onboarding-root',
  skipLink: 'onboarding-skip-link',
  navigation: 'onboarding-navigation',
  progress: 'onboarding-progress',
  backButton: 'onboarding-back',
  continueButton: 'onboarding-continue',
  skipButton: 'onboarding-skip',
  actionError: 'onboarding-action-error',
  actionErrorDismiss: 'onboarding-action-error-dismiss',
  athenaPanel: 'onboarding-athena-panel',
  athenaMessages: 'onboarding-athena-messages',
  intent: {
    surface: 'onboarding-intent',
    heading: 'onboarding-intent-heading',
    subheading: 'onboarding-intent-subheading',
    chip: (id: string) => `onboarding-intent-chip-${id}`,
    customText: 'onboarding-intent-custom-text',
    counter: 'onboarding-intent-counter',
  },
  integrations: {
    surface: 'onboarding-integrations',
    privacyNote: 'onboarding-integrations-privacy',
    card: (provider: string) => `onboarding-integration-${provider}`,
    status: (provider: string) => `onboarding-integration-status-${provider}`,
    action: (provider: string) => `onboarding-integration-action-${provider}`,
  },
  agenda: {
    surface: 'onboarding-agenda',
    date: 'onboarding-agenda-date',
    loading: 'onboarding-agenda-loading',
    empty: 'onboarding-agenda-empty',
    calendar: 'onboarding-agenda-calendar',
    legend: 'onboarding-agenda-legend',
    regenerate: 'onboarding-agenda-regenerate',
  },
  resumeBanner: {
    root: 'onboarding-resume-banner',
    resumeButton: 'onboarding-resume-button',
    dismissButton: 'onboarding-resume-dismiss',
  },
  error: {
    root: 'onboarding-error',
    retry: 'onboarding-error-retry',
  },
} as const;
