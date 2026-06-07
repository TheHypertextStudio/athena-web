'use client';

/**
 * `settings` — the Vocabulary tab.
 *
 * @remarks
 * Docket re-skins its entity nouns per organization: a startup's "Program" is an agency's
 * "Retainer", a nonprofit plans in "Seasons" rather than engineering "Cycles". This tab makes
 * that identity a point of pride — it shows the three built-in presets (Startup / Nonprofit /
 * Agency) as selectable cards, each with a live preview of every word it remaps, drawn from the
 * real {@link VOCABULARY_PRESETS} (never hardcoded labels). Selecting a preset updates the
 * preview immediately so the owner can feel the language change before committing.
 *
 * The org's current preset comes from its {@link VocabularySkin}. The selected preset is held
 * locally so the owner can compare options; {@link VocabularyTabProps.onApply} is invoked to
 * persist the choice.
 */
import type { VocabularyPreset, VocabularySkin } from '@docket/types';
import { cn } from '@docket/ui';
import { Check } from '@docket/ui/icons';
import { Button } from '@docket/ui/primitives';
import {
  type VocabularyKey,
  type VocabularyPresetMap,
  VOCABULARY_PRESETS,
} from '@docket/ui/vocabulary';
import type { JSX } from 'react';
import { useMemo, useState } from 'react';

/** The three selectable presets, with a one-line identity statement each. */
const PRESETS: readonly { value: VocabularyPreset; name: string; tagline: string }[] = [
  {
    value: 'startup',
    name: 'Startup',
    tagline: 'Neutral product language — programs, projects, and cycles.',
  },
  {
    value: 'nonprofit',
    name: 'Nonprofit',
    tagline: 'Mission-first — campaigns, seasons, and chapters.',
  },
  {
    value: 'agency',
    name: 'Agency',
    tagline: 'Client services — engagements, retainers, and sprints.',
  },
];

/** The vocabulary keys shown in the preview, in reading order. */
const PREVIEW_KEYS: readonly VocabularyKey[] = [
  'initiative',
  'program',
  'project',
  'cycle',
  'task',
  'team',
];

/** Props for {@link VocabularyTab}. */
export interface VocabularyTabProps {
  /** The org's current vocabulary skin (its active preset + any overrides). */
  skin: VocabularySkin | null;
  /** Whether the caller can change the org's vocabulary. */
  canManage: boolean;
  /** Whether an apply is currently in flight. */
  applying: boolean;
  /** A status note to surface after an apply attempt (success or failure). */
  notice: string | null;
  /** Whether the surfaced {@link VocabularyTabProps.notice} is an error. */
  noticeIsError: boolean;
  /** Persist the chosen preset. */
  onApply: (preset: VocabularyPreset) => void;
}

/**
 * The Vocabulary tab body.
 *
 * @param props - The {@link VocabularyTabProps}.
 * @returns the rendered tab panel body.
 */
export function VocabularyTab({
  skin,
  canManage,
  applying,
  notice,
  noticeIsError,
  onApply,
}: VocabularyTabProps): JSX.Element {
  const currentPreset: VocabularyPreset = skin?.preset ?? 'startup';
  const [selected, setSelected] = useState<VocabularyPreset>(currentPreset);

  const previewMap: VocabularyPresetMap = VOCABULARY_PRESETS[selected];
  const dirty = selected !== currentPreset;

  const currentPresetName = useMemo(
    () => PRESETS.find((p) => p.value === currentPreset)?.name ?? 'Startup',
    [currentPreset],
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <p className="text-muted-foreground text-sm leading-relaxed">
          Docket speaks your organization&rsquo;s language. Pick the preset that fits how your team
          works, and every screen relabels its nouns to match. You&rsquo;re currently using the{' '}
          <span className="text-foreground font-medium">{currentPresetName}</span> vocabulary.
        </p>
      </div>

      <div role="radiogroup" aria-label="Vocabulary preset" className="grid gap-3 sm:grid-cols-3">
        {PRESETS.map((preset) => {
          const isSelected = preset.value === selected;
          const isCurrent = preset.value === currentPreset;
          return (
            <button
              key={preset.value}
              type="button"
              role="radio"
              aria-checked={isSelected}
              disabled={!canManage}
              onClick={() => {
                setSelected(preset.value);
              }}
              className={cn(
                'focus-visible:ring-ring relative flex flex-col gap-1 rounded-xl border p-4 text-left transition-colors outline-none focus-visible:ring-2',
                isSelected
                  ? 'border-primary bg-primary/5'
                  : 'border-outline-variant bg-surface-container-low hover:border-primary/40',
                !canManage && 'cursor-not-allowed opacity-70',
              )}
            >
              <span className="flex items-center justify-between">
                <span className="text-foreground text-sm font-semibold">{preset.name}</span>
                {isSelected ? <Check aria-hidden="true" className="text-primary size-4" /> : null}
              </span>
              <span className="text-muted-foreground text-xs leading-snug">{preset.tagline}</span>
              {isCurrent ? (
                <span className="text-muted-foreground mt-1 text-[0.625rem] font-medium tracking-wide uppercase">
                  Current
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      <section
        aria-label="Vocabulary preview"
        className="border-outline-variant bg-surface-container-low rounded-xl border"
      >
        <div className="border-outline-variant border-b px-4 py-3">
          <h3 className="text-foreground text-sm font-semibold">
            How the {PRESETS.find((p) => p.value === selected)?.name ?? 'selected'} vocabulary reads
          </h3>
          <p className="text-muted-foreground text-xs">
            The words Docket uses across the app when this preset is active.
          </p>
        </div>
        <dl className="divide-border grid divide-y sm:grid-cols-2 sm:divide-y-0">
          {PREVIEW_KEYS.map((key, index) => {
            const term = previewMap[key];
            const defaultTerm = VOCABULARY_PRESETS.startup[key];
            const remapped = term.plural !== defaultTerm.plural;
            return (
              <div
                key={key}
                className={cn(
                  'flex items-center justify-between gap-3 px-4 py-3',
                  // Add the column divider on wider screens for the right column.
                  index % 2 === 1 && 'sm:border-border sm:border-l',
                )}
              >
                <dt className="text-muted-foreground text-xs capitalize">{key}</dt>
                <dd
                  className={cn(
                    'text-sm font-medium',
                    remapped ? 'text-primary' : 'text-foreground',
                  )}
                >
                  {term.singular}
                  <span className="text-muted-foreground font-normal"> / {term.plural}</span>
                </dd>
              </div>
            );
          })}
        </dl>
      </section>

      {notice ? (
        <p
          role={noticeIsError ? 'alert' : 'status'}
          className={cn(
            'rounded-lg border p-3 text-sm',
            noticeIsError
              ? 'border-destructive/40 text-destructive bg-destructive/5'
              : 'border-border text-muted-foreground',
          )}
        >
          {notice}
        </p>
      ) : null}

      {canManage ? (
        <div className="flex items-center gap-3">
          <Button
            disabled={!dirty || applying}
            onClick={() => {
              onApply(selected);
            }}
          >
            {applying ? 'Applying…' : 'Apply vocabulary'}
          </Button>
          {dirty ? (
            <Button
              variant="ghost"
              disabled={applying}
              onClick={() => {
                setSelected(currentPreset);
              }}
            >
              Reset
            </Button>
          ) : null}
        </div>
      ) : (
        <p className="text-muted-foreground text-sm">
          Only an owner or admin can change the organization&rsquo;s vocabulary.
        </p>
      )}
    </div>
  );
}
