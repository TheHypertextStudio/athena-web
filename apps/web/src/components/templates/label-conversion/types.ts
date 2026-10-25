import type { useConversionCommand } from './use-command';
/** A fixed published target and optional checked navigation hints. */
export interface ConversionPageProps {
  readonly orgId: string;
  readonly templateId: string;
  readonly versionId: string;
  readonly labelGroupId?: string;
  readonly labelId?: string;
}
/** The current account-owned command and its authoritative recovery state. */
export type ConversionCommand = ReturnType<typeof useConversionCommand>;
