/** Failure and refusal states for the canvas Properties editor. */
import { InlineBanner } from '@docket/ui/components';
import { Text } from '@docket/ui/primitives';

/** Props for {@link SourceError}. */
export interface SourceErrorProps {
  /** Application-owned copy naming the source that did not load. */
  readonly message: string;
  /** The retry action's label, distinct per source so each retry has its own name. */
  readonly retryLabel: string;
  /** Re-issue the read that failed. */
  readonly onRetry: () => void;
}

/** A property source that failed to load, kept beside the controls that still work. */
export function SourceError({ message, retryLabel, onRetry }: SourceErrorProps): React.JSX.Element {
  return (
    <InlineBanner
      tone="critical"
      density="compact"
      title={message}
      action={{ label: retryLabel, onSelect: onRetry }}
    />
  );
}

/** Props for {@link SelectionIssue}. */
export interface SelectionIssueProps {
  /** Why the selection cannot be edited, or `null` when it can. */
  readonly message: string | null;
}

/** The reason the current selection cannot be edited, or nothing when it can. */
export function SelectionIssue({ message }: SelectionIssueProps): React.JSX.Element | null {
  if (message === null) return null;
  return (
    <Text as="p" token="body-medium" tone="error">
      {message}
    </Text>
  );
}
