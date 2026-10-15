import type {
  BlueprintPreviewWarning,
  BlueprintWarningCode,
} from '@docket/work/work-template-blueprint';
import { InlineBanner } from '@docket/ui/components';
import type { JSX } from 'react';

const COPY: Record<BlueprintWarningCode, string> = {
  missing_anchor: 'Dated work has no parent date. Choose its timing in the draft.',
  waiting_completion: 'Timing waits for other work to finish. Review its completion rule.',
  capture_actor: 'A specific person becomes unassigned. Choose a reusable responsibility rule.',
  capture_team: 'A specific team was removed. Choose how future work finds its team.',
  capture_cycle: 'A specific cycle was removed. Review how future work joins a cycle.',
  capture_dependency:
    'A dependency outside a captured sibling group was excluded. Review the work order.',
  actor_unavailable: 'A responsibility rule has no available person. Review it before reuse.',
  athena_unavailable: 'Athena is unavailable for a responsibility rule. Review it before reuse.',
  cycle_unavailable: 'No suitable cycle is available. Review the cycle rule.',
  label_unavailable: 'Unavailable labels were omitted. Review labels in the draft.',
  warning_overflow: 'More work needs review. Check the complete outline in the draft.',
};

const ADOPTION_COPY: Partial<Record<BlueprintWarningCode, string>> = {
  missing_anchor: 'Work without a parent date stays undated.',
  waiting_completion: 'Timing waits for prerequisite work to finish.',
  actor_unavailable: 'An unavailable responsibility rule leaves work unassigned.',
  athena_unavailable: 'Athena is unavailable. Added work stays unassigned.',
  cycle_unavailable: 'No suitable cycle is available for added work.',
  label_unavailable: 'Unavailable labels are omitted from newly added work.',
  warning_overflow: 'More planned work needs review.',
};

/** Explain typed capture and adoption warnings with application-owned copy. */
export function WorkTemplateCaptureWarnings({
  warnings,
  intent = 'capture',
}: {
  readonly warnings: readonly BlueprintPreviewWarning[];
  readonly intent?: 'capture' | 'adoption';
}): JSX.Element | null {
  if (warnings.length === 0) return null;
  return (
    <InlineBanner
      tone="warning"
      density="compact"
      title={intent === 'capture' ? 'Review before reuse' : 'Review added work'}
    >
      <ul className="list-disc space-y-1 pl-4">
        {warnings.map((warning) => (
          <li key={warning.code}>
            {intent === 'adoption'
              ? (ADOPTION_COPY[warning.code] ?? COPY[warning.code])
              : COPY[warning.code]}{' '}
            <span>
              {warning.count} {warning.count === 1 ? 'item' : 'items'}.
            </span>
          </li>
        ))}
      </ul>
    </InlineBanner>
  );
}
