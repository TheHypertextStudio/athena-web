'use client';

/**
 * `onboarding/step-vocabulary` — the team / nonprofit fork's "speak your world's language" screen.
 *
 * @remarks
 * Sells vocabulary skins as a feature: Docket renames its core entities to fit how an
 * organization actually talks (an agency sees "Engagements" and "Pods" where a startup sees
 * "Initiatives" and "Teams"). The preview is rendered from the REAL preset data in
 * `@docket/ui/vocabulary` — never hand-written sample labels — so what the user sees here is
 * exactly what the app will render once the org exists.
 */
import { VOCABULARY_PRESETS, type VocabularyKey } from '@docket/ui/vocabulary';
import type { JSX } from 'react';

import { SelectableCard } from './selectable-card';
import type { Vocabulary } from './types';

/** Display metadata for a selectable vocabulary preset. */
interface VocabularyOption {
  /** The `OrgCreate.vocabulary` value this option submits. */
  value: Exclude<Vocabulary, undefined>;
  /** Human label for the preset. */
  label: string;
  /** A one-line description of who the preset fits. */
  description: string;
}

/** The selectable presets, in display order, matched to the real {@link VOCABULARY_PRESETS}. */
const VOCABULARY_OPTIONS: readonly VocabularyOption[] = [
  {
    value: 'startup',
    label: 'Startup',
    description: 'Neutral product language for teams shipping software.',
  },
  {
    value: 'nonprofit',
    label: 'Nonprofit',
    description: 'Mission-oriented language for programs and the people they serve.',
  },
  {
    value: 'agency',
    label: 'Agency',
    description: 'Client-services language for retainers, engagements, and pods.',
  },
];

/**
 * The vocabulary keys previewed under each preset.
 *
 * @remarks
 * A representative subset of the full skin — the keys most likely to differ between presets —
 * so the card stays scannable while still making the renaming concrete.
 */
const PREVIEW_KEYS: readonly VocabularyKey[] = ['initiative', 'program', 'cycle', 'team'];

/** Props for {@link StepVocabulary}. */
export interface StepVocabularyProps {
  /** The currently-selected preset. */
  value: Vocabulary;
  /** Invoked with the chosen preset when a card is selected. */
  onChange: (value: Vocabulary) => void;
}

/**
 * The team / nonprofit fork's vocabulary step, with a live preview of each preset's labels.
 */
export function StepVocabulary({ value, onChange }: StepVocabularyProps): JSX.Element {
  return (
    <div className="grid gap-3">
      {VOCABULARY_OPTIONS.map((option) => {
        const preset = VOCABULARY_PRESETS[option.value];
        const selected = value === option.value;
        return (
          <SelectableCard
            key={option.value}
            selected={selected}
            onSelect={() => {
              onChange(option.value);
            }}
            title={option.label}
            description={option.description}
          >
            <ul className="flex flex-wrap gap-1.5 pr-6" aria-label={`${option.label} terms`}>
              {PREVIEW_KEYS.map((key) => (
                <li
                  key={key}
                  className="border-outline-variant bg-surface-container text-on-surface-variant rounded-md border px-2 py-0.5 text-xs font-medium"
                >
                  {preset[key].plural}
                </li>
              ))}
            </ul>
          </SelectableCard>
        );
      })}
    </div>
  );
}
