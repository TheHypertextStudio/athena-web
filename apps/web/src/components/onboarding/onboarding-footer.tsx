'use client';

import type { JSX } from 'react';
import { InlineBanner } from '@docket/ui/components';
import { Button } from '@docket/ui/primitives/button';
import { primaryLabel } from './onboarding-copy';
import type { OnboardingStep } from './types';

/** Current setup state and the same explicit continue/skip actions used by the wizard. */
export interface OnboardingFooterProps {
  readonly step: OnboardingStep;
  readonly pending: boolean;
  readonly mirroredTotal: number;
  readonly nameReady: boolean;
  readonly onPrimary: () => void;
  readonly onSkip: () => void;
}

/** Keep optional setup actions usable on a phone without duplicating the gallery's decisions. */
export function OnboardingFooter(props: OnboardingFooterProps): JSX.Element {
  const connect = props.step === 'connect';
  const optional = props.step === 'passkey' || props.step === 'starters';
  return (
    <>
      {optional ? (
        <Button
          wrapLabel
          type="button"
          variant="ghost"
          disabled={props.pending}
          onClick={props.onSkip}
        >
          Skip for now
        </Button>
      ) : null}
      {props.step !== 'intent' ? (
        <Button
          wrapLabel
          type="button"
          onClick={props.onPrimary}
          disabled={props.pending || (props.step === 'name' && !props.nameReady)}
        >
          {primaryLabel(props.step, connect, props.pending, props.mirroredTotal)}
        </Button>
      ) : null}
    </>
  );
}

/** Present setup failure across the full wizard column, before the shared action row. */
export function OnboardingNotice({ message }: { readonly message: string }): JSX.Element {
  return (
    <InlineBanner tone="critical" density="compact" title="Could not continue">
      {message}
    </InlineBanner>
  );
}
