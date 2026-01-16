/**
 * Intent surface for step 1 of onboarding.
 *
 * Collects user's intent for using Athena through:
 * - Curated intent chips (multi-select)
 * - Optional free-text elaboration
 *
 * @packageDocumentation
 */

'use client';

import { motion } from 'framer-motion';
import CheckIcon from '@mui/icons-material/Check';
import { useOnboardingStore } from '@/lib/onboarding';
import { cn } from '@/lib/utils';
import { ONBOARDING_TEST_IDS } from '../test-ids';

/**
 * IntentSurface component for collecting user intent.
 */
export function IntentSurface() {
  const { availableChips, selectedChips, customText, toggleChip, setCustomText } =
    useOnboardingStore();

  return (
    <div className="mx-auto max-w-xl" data-testid={ONBOARDING_TEST_IDS.intent.surface}>
      <h2
        className="text-headline-small text-on-surface mb-2"
        data-testid={ONBOARDING_TEST_IDS.intent.heading}
      >
        What brings you to Athena?
      </h2>
      <p
        className="text-body-medium text-on-surface-variant mb-6"
        data-testid={ONBOARDING_TEST_IDS.intent.subheading}
      >
        Select all that apply, or tell us in your own words.
      </p>

      {/* Chip grid */}
      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {availableChips.map((chip, index) => (
          <IntentChip
            key={chip.id}
            id={chip.id}
            label={chip.label}
            icon={chip.icon}
            selected={selectedChips.includes(chip.id)}
            onToggle={() => {
              toggleChip(chip.id);
            }}
            delay={index * 0.05}
            testId={ONBOARDING_TEST_IDS.intent.chip(chip.id)}
          />
        ))}
      </div>

      {/* Custom text input */}
      <div className="mt-6">
        <label
          htmlFor="custom-intent"
          className="text-label-medium text-on-surface-variant mb-2 block"
        >
          Tell me more (optional)
        </label>
        <textarea
          id="custom-intent"
          data-testid={ONBOARDING_TEST_IDS.intent.customText}
          value={customText}
          onChange={(e) => {
            setCustomText(e.target.value);
          }}
          placeholder="I'm launching a startup and need to balance product work with investor meetings..."
          className={cn(
            'w-full rounded-lg border p-4',
            'border-outline-variant bg-surface-container-low',
            'text-body-medium text-on-surface',
            'placeholder:text-on-surface-variant/50',
            'focus:border-primary focus:ring-primary focus:ring-1 focus:outline-none',
            'resize-none',
          )}
          rows={3}
          maxLength={500}
        />
        <p
          className="text-label-small text-on-surface-variant mt-1 text-right"
          data-testid={ONBOARDING_TEST_IDS.intent.counter}
        >
          {customText.length}/500
        </p>
      </div>
    </div>
  );
}

interface IntentChipProps {
  id: string;
  label: string;
  icon: string;
  selected: boolean;
  onToggle: () => void;
  delay?: number;
  testId: string;
}

function IntentChip({
  id: _id,
  label,
  icon,
  selected,
  onToggle,
  delay = 0,
  testId,
}: IntentChipProps) {
  return (
    <motion.button
      type="button"
      onClick={onToggle}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, delay }}
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
      className={cn(
        'relative flex items-center gap-3 rounded-xl p-4',
        'border-2 transition-colors duration-150',
        selected
          ? 'border-primary bg-primary-container'
          : 'border-outline-variant bg-surface-container hover:border-outline',
      )}
      aria-pressed={selected}
      aria-label={`${label}, ${selected ? 'selected' : 'not selected'}`}
      data-testid={testId}
      data-intent-chip={_id}
      data-selected={selected}
    >
      <span className="text-2xl" role="img" aria-hidden>
        {icon}
      </span>
      <span
        className={cn(
          'text-label-large flex-1 text-left',
          selected ? 'text-on-primary-container' : 'text-on-surface',
        )}
      >
        {label}
      </span>
      <div
        className={cn(
          'flex h-5 w-5 items-center justify-center rounded-full',
          'transition-colors duration-150',
          selected ? 'bg-primary text-on-primary' : 'border-outline-variant border',
        )}
      >
        {selected && <CheckIcon sx={{ fontSize: 14 }} />}
      </div>
    </motion.button>
  );
}
