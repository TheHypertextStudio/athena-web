'use client';

import { Sparkles } from '@docket/ui/icons';
import { DropdownMenuItem } from '@docket/ui/primitives';
import type { JSX } from 'react';

import type { PersonalAthenaContext } from '@/lib/athena/presentation';

import { useAthenaPanel } from './athena-panel-provider';

/** Props for a contextual Athena row inside an object action menu. */
export interface AthenaContextMenuItemProps {
  readonly label: string;
  readonly context?: PersonalAthenaContext | null;
}

/** Open the shared personal Athena dock from an overflow menu. */
export function AthenaContextMenuItem({
  label,
  context = null,
}: AthenaContextMenuItemProps): JSX.Element {
  const { openAthena } = useAthenaPanel();

  return (
    <DropdownMenuItem
      onSelect={() => {
        openAthena(context);
      }}
    >
      <Sparkles aria-hidden="true" />
      {label}
    </DropdownMenuItem>
  );
}
