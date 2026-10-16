'use client';
import type { JSX, ReactNode } from 'react';
import { ChevronDown } from '@docket/ui/icons';
import {
  Button,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Surface,
} from '@docket/ui/primitives';

/** Reveal infrequent template controls without obscuring the work being authored. */
export function TemplateDisclosure({
  title,
  children,
  defaultOpen = false,
}: {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
}): JSX.Element {
  return (
    <Surface tone="card" shape="medium" pad="none" className="contents sm:block sm:p-2">
      <Collapsible className="min-w-0" defaultOpen={defaultOpen}>
        <CollapsibleTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            className="group w-full justify-between gap-3 px-0 text-left sm:px-4"
          >
            <span className="min-w-0 whitespace-normal">{title}</span>
            <ChevronDown className="size-5 shrink-0 transition-transform group-data-[state=open]:rotate-180 motion-reduce:transition-none" />
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="flex min-w-0 flex-col gap-3 px-0 pt-2 pb-3 sm:gap-4 sm:px-1 sm:pt-3 sm:pb-4">
            {children}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </Surface>
  );
}
