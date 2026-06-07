'use client';

/**
 * `@docket/ui` — the vocabulary resolver hook and its provider.
 *
 * @remarks
 * Docket re-skins entity nouns per org (a startup's "Program" is an agency's "Retainer").
 * {@link VocabularyProvider} is scoped to the active org's {@link VocabularySkin} (the Hub
 * uses {@link presetStartup}); {@link useVocabulary} resolves a label for a
 * {@link VocabularyKey} with the precedence:
 *
 * 1. `org.vocabulary.overrides[key]` (per-org override), then
 * 2. `preset[key]` (the org's selected preset), then
 * 3. `presetStartup[key]` (the neutral fallback).
 *
 * Components must NEVER hardcode entity labels — always route them through this hook.
 */
import type { VocabularySkin, VocabularyTerm } from '@docket/types';
import * as React from 'react';

import {
  type VocabularyKey,
  type VocabularyPresetMap,
  VOCABULARY_PRESETS,
  presetStartup,
} from '../vocabulary/presets';

/** The resolved-vocabulary value exposed by the provider. */
export interface VocabularyContextValue {
  /** The org's active vocabulary skin, or `null` for the Hub (startup defaults). */
  readonly skin: VocabularySkin | null;
}

/** Internal React context; consumed only through {@link useVocabulary}. */
const VocabularyContext = React.createContext<VocabularyContextValue | null>(null);

/** Options accepted by {@link useVocabulary}. */
export interface UseVocabularyOptions {
  /** Return the `plural` form instead of the `singular`. Defaults to `false`. */
  plural?: boolean;
}

/** Props for {@link VocabularyProvider}. */
export interface VocabularyProviderProps {
  /**
   * The active org's vocabulary skin. Pass `null` (or omit) for the Hub, which always
   * resolves to {@link presetStartup}.
   */
  skin?: VocabularySkin | null;
  /** The subtree whose components resolve labels via {@link useVocabulary}. */
  children: React.ReactNode;
}

/**
 * Provide the active org's {@link VocabularySkin} to descendant {@link useVocabulary} calls.
 *
 * @remarks
 * Pass the org's `vocabulary` skin when an org is bound; pass `null` on the Hub so labels
 * fall back to the neutral startup preset.
 */
export function VocabularyProvider({
  skin = null,
  children,
}: VocabularyProviderProps): React.JSX.Element {
  const value = React.useMemo<VocabularyContextValue>(() => ({ skin }), [skin]);
  return <VocabularyContext.Provider value={value}>{children}</VocabularyContext.Provider>;
}

/** Resolve the full {@link VocabularyTerm} for a key against a skin (override → preset → startup). */
function resolveTerm(skin: VocabularySkin | null, key: VocabularyKey): VocabularyTerm {
  const override = skin?.overrides?.[key];
  if (override) return override;
  const preset: VocabularyPresetMap = skin ? VOCABULARY_PRESETS[skin.preset] : presetStartup;
  return preset[key];
}

/**
 * Resolve the org-skinned label for a vocabulary key.
 *
 * @param key - The vocabulary key to resolve (e.g. `'program'`).
 * @param opts - Resolution options; set `plural` for the plural form.
 * @returns the resolved label string, honoring the active org's overrides and preset.
 *
 * @example
 * ```tsx
 * const programs = useVocabulary('program', { plural: true });
 * // startup → "Programs", agency → "Retainers"
 * ```
 */
export function useVocabulary(key: VocabularyKey, opts?: UseVocabularyOptions): string {
  const ctx = React.useContext(VocabularyContext);
  const skin = ctx?.skin ?? null;
  const term = resolveTerm(skin, key);
  return opts?.plural ? term.plural : term.singular;
}
