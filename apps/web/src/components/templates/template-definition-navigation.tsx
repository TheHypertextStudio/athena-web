'use client';
import { useRef, type JSX } from 'react';
import { ChevronDown } from '@docket/ui/icons';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
  Tabs,
  type TabsActivation,
} from '@docket/ui/primitives';
import type { TemplateDefinitionSection } from './use-template-section-navigation';
interface DefinitionNavigationProps {
  readonly section: TemplateDefinitionSection;
  readonly onValueChange: (next: string, source?: TabsActivation) => void;
}
const SECTIONS = [
  { value: 'purpose', label: 'Purpose' },
  { value: 'work', label: 'Starting work' },
  { value: 'structure', label: 'Included work' },
  { value: 'review', label: 'Review' },
] as const;
/** Freely revisit definition sections without losing input or creating duplicate tab identities. */
export function TemplateDefinitionNavigation(props: DefinitionNavigationProps): JSX.Element {
  const selectedIndex = SECTIONS.findIndex((item) => item.value === props.section);
  const pendingSection = useRef<string | null>(null);
  return (
    <>
      <div className="sm:hidden">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="secondary"
              aria-label="Change definition step"
              className="w-full justify-between"
            >
              {selectedIndex + 1} of {SECTIONS.length} · {SECTIONS[selectedIndex]?.label}
              <ChevronDown aria-hidden="true" className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            width="sm"
            onCloseAutoFocus={(event) => {
              const next = pendingSection.current;
              pendingSection.current = null;
              if (next === null || next === props.section) return;
              // Move panel focus after the menu releases its focus trap.
              event.preventDefault();
              props.onValueChange(next);
            }}
          >
            <DropdownMenuRadioGroup
              value={props.section}
              onValueChange={(next) => {
                pendingSection.current = next;
              }}
            >
              {SECTIONS.map((item) => (
                <DropdownMenuRadioItem key={item.value} value={item.value}>
                  {item.label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="hidden sm:block">
        <Tabs
          variant="contained"
          label="Work definition sections"
          value={props.section}
          onValueChange={props.onValueChange}
          items={SECTIONS}
        />
      </div>
    </>
  );
}
