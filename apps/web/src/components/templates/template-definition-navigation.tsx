'use client';
import { useId, useRef, type JSX } from 'react';
import { ChevronDown } from '@docket/ui/icons';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
  Tabs,
} from '@docket/ui/primitives';
import type { TemplateDefinitionSection } from './use-template-section-navigation';

const steps = [
  { value: 'purpose', label: 'Purpose' },
  { value: 'work', label: 'Starting work' },
  { value: 'structure', label: 'Included work' },
  { value: 'review', label: 'Review' },
] as const;

interface DefinitionNavigationProps {
  readonly section: TemplateDefinitionSection;
  readonly onValueChange: (next: string) => void;
}

/** Keep the current decision visible on phones and expose other steps when requested. */
export function TemplateDefinitionNavigation(props: DefinitionNavigationProps): JSX.Element {
  return (
    <>
      <div className="sm:hidden">
        <MobileDefinitionNavigation {...props} />
      </div>
      <div className="hidden sm:block">
        <Tabs
          label="Work definition sections"
          variant="segmented"
          tone="accent"
          className="grid w-full grid-cols-4 [&>[role=tab]]:min-w-0 [&>[role=tab]]:justify-center [&>[role=tab]]:px-2 [&>[role=tab]>span]:text-clip [&>[role=tab]>span]:whitespace-normal"
          value={props.section}
          onValueChange={props.onValueChange}
          items={steps}
        />
      </div>
    </>
  );
}

function MobileDefinitionNavigation({
  section,
  onValueChange,
}: DefinitionNavigationProps): JSX.Element {
  const labelId = useId();
  const requestedStep = useRef<string | null>(null);
  const index = steps.findIndex((step) => step.value === section);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="secondary"
          className="w-full min-w-0 justify-between"
          aria-label="Change definition step"
          aria-describedby={labelId}
        >
          <span id={labelId} className="min-w-0 text-left">
            {index + 1} of {steps.length} · {steps[index]?.label}
          </span>
          <ChevronDown aria-hidden className="size-4 shrink-0" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        onCloseAutoFocus={(event) => {
          const next = requestedStep.current;
          requestedStep.current = null;
          if (next) {
            // Release the menu's focus scope before section navigation restores a field or heading.
            event.preventDefault();
            onValueChange(next);
          }
        }}
      >
        <DropdownMenuRadioGroup
          aria-label="Definition step"
          value={section}
          onValueChange={(next) => {
            requestedStep.current = next !== section ? next : null;
          }}
        >
          {steps.map((step) => (
            <DropdownMenuRadioItem key={step.value} value={step.value}>
              {step.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
