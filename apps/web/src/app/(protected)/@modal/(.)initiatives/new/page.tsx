/**
 * Intercepted modal route for creating a new initiative.
 *
 * Reuses InitiativeForm inside a modal dialog for quick creation
 * without leaving the current page context.
 *
 * @packageDocumentation
 */

'use client';

import { useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import * as Dialog from '@radix-ui/react-dialog';
import { VisuallyHidden } from '@radix-ui/react-visually-hidden';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { InitiativeForm } from '@/components/initiatives/initiative-form';
import { initiativesApi } from '@/lib/api-client';

export default function NewInitiativeModalPage() {
  const router = useRouter();

  // Fetch existing initiatives for parent selection
  const { data: initiativesData } = useQuery({
    queryKey: ['initiatives'],
    queryFn: () => initiativesApi.list(),
  });

  const parentOptions = (initiativesData?.data ?? [])
    .filter((i) => i.statusCategory !== 'archived')
    .map((i) => ({ id: i.id, name: i.name }));

  const handleClose = useCallback(() => {
    router.back();
  }, [router]);

  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) handleClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay
          className={cn(
            'fixed inset-0 z-50 bg-black/50 backdrop-blur-sm',
            'data-[state=open]:animate-in data-[state=open]:fade-in-0',
            'data-[state=closed]:animate-out data-[state=closed]:fade-out-0',
          )}
        />
        <Dialog.Content
          className={cn(
            'fixed top-[5%] left-1/2 z-50 w-full max-w-lg -translate-x-1/2',
            'max-h-[90vh] overflow-y-auto',
            'bg-surface-container rounded-2xl p-6 shadow-xl',
            'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95',
            'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95',
            'duration-200 outline-none',
          )}
        >
          <div className="mb-4 flex items-center justify-between">
            <Dialog.Title className="text-on-surface text-xl font-bold">
              New Initiative
            </Dialog.Title>
            <Button variant="text" size="icon" onClick={handleClose}>
              <X className="h-5 w-5" />
            </Button>
          </div>

          <VisuallyHidden asChild>
            <Dialog.Description>
              Create a new strategic initiative to organize your projects.
            </Dialog.Description>
          </VisuallyHidden>

          <InitiativeForm parentOptions={parentOptions} />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
