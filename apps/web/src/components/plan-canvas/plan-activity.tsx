'use client';

import { type JSX, type ReactNode, useCallback, useState } from 'react';
import { RailPresentationProvider, RailSheetBarSlotProvider } from '@docket/ui/components';
import { ChevronLeft, MessageSquare } from '@docket/ui/icons';
import { Button, Sheet, SheetClose, SheetContent, SheetTitle } from '@docket/ui/primitives';
import { AthenaPanelProvider, useAthenaPanel } from '@/components/athena/athena-panel-provider';
import { PageContextProvider } from '@/components/athena/page-context';
import { PlanRailConversation } from './plan-conversation';

/** Keep the real plan conversation optional and local to the focused planning activity. */
export function PlanActivityProvider({
  orgId,
  children,
}: {
  readonly orgId: string;
  readonly children: ReactNode;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const reveal = useCallback(() => {
    setOpen(true);
  }, []);
  return (
    <PageContextProvider workspace={{ workspaceId: orgId }}>
      <AthenaPanelProvider onRevealRail={reveal} railVisible={open}>
        {children}
        <PlanConversationSheet orgId={orgId} open={open} onOpenChange={setOpen} />
      </AthenaPanelProvider>
    </PageContextProvider>
  );
}

/** Open contextual help without introducing global navigation into the plan. */
export function PlanAthenaAction(): JSX.Element {
  const { openAthena } = useAthenaPanel();
  return (
    <Button
      variant="ghost"
      size="sm"
      aria-label="Ask Athena about this plan"
      onClick={() => {
        openAthena();
      }}
    >
      <MessageSquare aria-hidden="true" className="size-4" />
      <span className="hidden @2xl:inline">Ask Athena</span>
    </Button>
  );
}

function PlanConversationSheet({
  orgId,
  open,
  onOpenChange,
}: {
  readonly orgId: string;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}): JSX.Element {
  const [barSlot, setBarSlot] = useState<HTMLDivElement | null>(null);
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        size="wide"
        presentation="responsive-fullscreen"
        keepMounted
        aria-describedby={undefined}
      >
        <SheetTitle className="sr-only">Plan with Athena</SheetTitle>
        <div className="flex min-h-12 shrink-0 items-center gap-1 px-2 pt-[env(safe-area-inset-top)]">
          <SheetClose asChild>
            <Button variant="ghost" size="sm" iconOnly aria-label="Back to plan">
              <ChevronLeft aria-hidden="true" />
            </Button>
          </SheetClose>
          <div ref={setBarSlot} className="flex min-w-0 flex-1 items-center justify-end gap-1" />
        </div>
        <div className="@container min-h-0 flex-1">
          <RailPresentationProvider value="sheet">
            <RailSheetBarSlotProvider slot={barSlot}>
              <PlanRailConversation orgId={orgId} />
            </RailSheetBarSlotProvider>
          </RailPresentationProvider>
        </div>
      </SheetContent>
    </Sheet>
  );
}
