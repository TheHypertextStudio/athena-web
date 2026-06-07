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
 *
 * The copy is gated on {@link VocabularyTabProps.isPersonal}: a personal workspace is the
 * caller's own space, not an organization with other people in it, so the intro prose, the
 * permission note, and the multi-tenant `team` preview row are all dropped or reframed — no
 * "organization"/"your team"/"Teams" wording surfaces there.
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

/**
 * The vocabulary keys shown in the preview, in reading order.
 *
 * @remarks
 * `team` is a multi-tenant noun (grouping members), so it is omitted in a personal workspace —
 * see {@link previewKeys}. The remaining nouns are meaningful for one person.
 */
const PREVIEW_KEYS: readonly VocabularyKey[] = [
  'initiative',
  'program',
  'project',
  'cycle',
  'task',
  'team',
];

/**
 * The preview keys for a given workspace.
 *
 * @param isPersonal - Whether the active workspace is the caller's personal space.
 * @returns the preview keys, dropping the multi-tenant `team` row for a personal workspace.
 */
function previewKeys(isPersonal: boolean): readonly VocabularyKey[] {
  return isPersonal ? PREVIEW_KEYS.filter((key) => key !== 'team') : PREVIEW_KEYS;
}

/** Props for {@link VocabularyTab}. */
export interface VocabularyTabProps {
  /** The org's current vocabulary skin (its active preset + any overrides). */
  skin: VocabularySkin | null;
  /** Whether the caller can change the org's vocabulary. */
  canManage: boolean;
  /**
   * Whether the active workspace is the caller's personal space (`OrgSummary.isPersonal`).
   *
   * @remarks
   * Purely presentational: a personal workspace drops the org/multi-tenant framing (intro prose,
   * permission note, the `team` preview row). Defaults to `false` (shared-org framing).
   */
  isPersonal?: boolean;
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
  isPersonal = false,
  applying,
  notice,
  noticeIsError,
  onApply,
}: VocabularyTabProps): JSX.Element {
  const currentPreset: VocabularyPreset = skin?.preset ?? 'startup';
  const [selected, setSelected] = useState<VocabularyPreset>(currentPreset);

  const previewMap: VocabularyPresetMap = VOCABULARY_PRESETS[selected];
  const keys = previewKeys(isPersonal);
  const dirty = selected !== currentPreset;

  const currentPresetName = useMemo(
    () => PRESETS.find((p) => p.value === currentPreset)?.name ?? 'Startup',
    [currentPreset],
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <p className="text-muted-foreground text-sm leading-relaxed">
          {isPersonal
            ? 'Choose the words Docket uses across your space. Pick the preset that fits how you work, and every screen relabels its nouns to match.'
            : 'Docket speaks your organization’s language. Pick the preset that fits how your team works, and every screen relabels its nouns to match.'}{' '}
          You&rsquo;re currently using the{' '}
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
          {keys.map((key, index) => {
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
          {isPersonal
            ? 'You don’t have permission to change this vocabulary.'
            : 'Only an owner or admin can change the organization’s vocabulary.'}
        </p>
      )}
    </div>
  );
}
