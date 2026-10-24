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
  tabIds,
} from '@docket/ui/primitives';
import type { TemplateDefinitionSection } from './use-template-section-navigation';
interface DefinitionNavigationProps {
  readonly pending?: boolean;
  readonly mode?: 'create' | 'edit';
  readonly reached?: number | undefined;
  readonly scope?: string;
  readonly section: TemplateDefinitionSection;
  readonly onValueChange: (next: string, source?: TabsActivation) => void;
}
/** Ordered authoring destinations shared by navigation and creation actions. */
export const TEMPLATE_SECTIONS = [
  { value: 'purpose', label: 'Purpose' },
  { value: 'work', label: 'Starting work' },
  { value: 'structure', label: 'Included work' },
  { value: 'review', label: 'Review' },
] as const;
/** Freely revisit definition sections without losing input or creating duplicate tab identities. */
export function TemplateDefinitionNavigation(props: DefinitionNavigationProps): JSX.Element {
  const selectedIndex = TEMPLATE_SECTIONS.findIndex((item) => item.value === props.section);
  const pendingSection = useRef<string | null>(null);
  if (props.mode === 'create') return <TemplateCreationNavigation {...props} />;
  return (
    <>
      <div className="sm:hidden">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="secondary"
              aria-label="Change template section"
              className="w-full justify-between"
            >
              {TEMPLATE_SECTIONS[selectedIndex]?.label}
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
              {TEMPLATE_SECTIONS.map((item) => (
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
          label="Template sections"
          value={props.section}
          onValueChange={props.onValueChange}
          items={TEMPLATE_SECTIONS}
        />
      </div>
    </>
  );
}

function TemplateCreationNavigation(props: DefinitionNavigationProps): JSX.Element {
  const selectedIndex = TEMPLATE_SECTIONS.findIndex((item) => item.value === props.section);
  return (
    <nav aria-label="Create template">
      <ol className="grid grid-cols-4 gap-1 sm:gap-3">
        {TEMPLATE_SECTIONS.map((item, index) => (
          <li key={item.value} className="min-w-0">
            <Button
              id={props.scope ? tabIds(props.scope, item.value).id : undefined}
              type="button"
              variant={props.section === item.value ? 'secondary' : 'ghost'}
              aria-current={props.section === item.value ? 'step' : undefined}
              aria-controls={props.scope ? tabIds(props.scope, item.value).panelId : undefined}
              disabled={props.pending === true || index > (props.reached ?? selectedIndex)}
              className="h-auto min-h-14 w-full min-w-0 flex-col gap-1 px-1 py-2 text-center whitespace-normal sm:min-h-12 sm:flex-row sm:gap-2"
              onClick={() => {
                props.onValueChange(item.value);
              }}
            >
              <span aria-hidden="true" className="text-label-small">
                {index + 1}
              </span>
              <span className="text-label-large">{item.label}</span>
            </Button>
          </li>
        ))}
      </ol>
    </nav>
  );
}
