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
}: {
  title: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <Surface tone="card" shape="large" pad="tight">
      <Collapsible className="min-w-0">
        <CollapsibleTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            className="group w-full justify-between gap-3 text-left"
          >
            <span className="min-w-0 whitespace-normal">{title}</span>
            <ChevronDown className="size-5 shrink-0 transition-transform group-data-[state=open]:rotate-180 motion-reduce:transition-none" />
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="flex min-w-0 flex-col gap-4 px-1 pt-3 pb-4">{children}</div>
        </CollapsibleContent>
      </Collapsible>
    </Surface>
  );
}
