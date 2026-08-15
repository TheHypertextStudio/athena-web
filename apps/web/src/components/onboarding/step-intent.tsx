'use client';

/**
 * `onboarding/step-intent` — the first screen: "What brings you to Docket?".
 *
 * @remarks
 * Three large choice cards fork the rest of the wizard and record the org's informational
 * `intent`. The fork is front-loaded so each subsequent screen stays about one concept.
 */
import { Sparkles, User, Users } from '@docket/ui/icons';
import type { LucideIcon } from '@docket/ui/icons';
import type { JSX } from 'react';

import { SelectableCard } from './selectable-card';
import type { OnboardingIntent } from './types';

/** One intent fork rendered as a large choice card. */
interface IntentOption {
  /** The `OrgCreate.intent` value this option submits. */
  intent: OnboardingIntent;
  /** Card headline. */
  title: string;
  /** Supporting sentence. */
  description: string;
  /** The leading glyph for the card. */
  icon: LucideIcon;
}

/**
 * The three onboarding forks, in display order.
 */
export const INTENT_OPTIONS: readonly IntentOption[] = [
  {
    intent: 'personal',
    title: 'Just me',
    description: 'Plan, schedule, and track your own work.',
    icon: User,
  },
  {
    intent: 'startup',
    title: 'My team or company',
    description: 'Plan and track work with other people.',
    icon: Users,
  },
  {
    intent: 'nonprofit',
    title: 'A nonprofit',
    description: 'Plan programs, initiatives, and shared responsibilities.',
    icon: Sparkles,
  },
];

/** Props for {@link StepIntent}. */
export interface StepIntentProps {
  /** The currently-selected intent, or `null` before a choice is made. */
  value: OnboardingIntent | null;
  /** Invoked with the chosen intent when a card is selected. */
  onChange: (intent: OnboardingIntent) => void;
}

/**
 * Step 1 — pick the fork that best describes why you're here.
 *
 * @remarks
 * Selecting a card both records the intent and (via the orchestrator) advances the wizard, so
 * there is no separate "next" affordance for this screen — the choice is the action.
 */
export function StepIntent({ value, onChange }: StepIntentProps): JSX.Element {
  return (
    <div className="grid gap-3">
      {INTENT_OPTIONS.map((option) => (
        <SelectableCard
          key={option.intent}
          selected={value === option.intent}
          onSelect={() => {
            onChange(option.intent);
          }}
          title={option.title}
          description={option.description}
          icon={option.icon}
        />
      ))}
    </div>
  );
}
