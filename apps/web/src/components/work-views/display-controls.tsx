'use client';

import { TuneRounded } from '@docket/ui/icons';
import {
  Button,
  type ButtonProps,
  Popover,
  PopoverBody,
  PopoverContent,
  PopoverTrigger,
} from '@docket/ui/primitives';
import type { ViewTarget } from '@docket/work/view-contract';
import { type ReactElement, type ReactNode, useRef, useState } from 'react';

import { DisplayControlPanel, type DisplayPanel } from './display-control-panel';
import type { WorkViewDefinitionFor } from './view-state';

/** Props for the bounded Display command surface. */
export interface DisplayControlsProps<TTarget extends ViewTarget> {
  readonly target: TTarget;
  readonly definition: WorkViewDefinitionFor<TTarget>;
  readonly onChange: (definition: WorkViewDefinitionFor<TTarget>) => void;
  /** Open the temporary roster finder from the Display root. */
  readonly onFind?: (() => void) | undefined;
  readonly trigger: ReactNode;
  readonly open?: boolean;
  readonly onOpenChange?: (open: boolean) => void;
}

/** Edit layout immediately, then open focused Organize and Properties subpanels on demand. */
export function DisplayControls<TTarget extends ViewTarget>({
  target,
  definition,
  onChange,
  onFind,
  trigger,
  open,
  onOpenChange,
}: DisplayControlsProps<TTarget>): ReactElement {
  const [internalOpen, setInternalOpen] = useState(false);
  const [panel, setPanel] = useState<DisplayPanel>('root');
  const preserveFindFocus = useRef(false);
  const actualOpen = open ?? internalOpen;

  function setOpen(next: boolean): void {
    if (!next) setPanel('root');
    if (onOpenChange) onOpenChange(next);
    else setInternalOpen(next);
  }

  return (
    <Popover open={actualOpen} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        presentation="panel"
        width="xl"
        role="dialog"
        aria-label="Display view"
        align="end"
        onCloseAutoFocus={(event) => {
          if (!preserveFindFocus.current) return;
          event.preventDefault();
          preserveFindFocus.current = false;
        }}
      >
        <PopoverBody inset="compact">
          <DisplayControlPanel
            panel={panel}
            target={target}
            definition={definition}
            onPanelChange={setPanel}
            onChange={onChange}
            onFind={() => {
              preserveFindFocus.current = true;
              onFind?.();
              setOpen(false);
            }}
          />
        </PopoverBody>
      </PopoverContent>
    </Popover>
  );
}

/** Compact MD3 trigger for the Display command surface. */
export function DisplayControlsTrigger({
  iconOnly,
  ...props
}: Omit<ButtonProps, 'children'>): ReactElement {
  return (
    <Button variant="ghost" iconOnly={iconOnly} aria-label="Display" {...props}>
      <TuneRounded aria-hidden />
      {iconOnly ? null : 'Display'}
    </Button>
  );
}
